import type { NavigationHost } from '@acorn/client-core/host/registries/commands'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import type { WorkspaceWords } from '@acorn/client-core/features/workspaces'
import { chooseProject } from './routing'
import type { ShellModel } from './model'

// The terminal's half of the Go to commands
// (client-core/host/registries/commands/navigationCommands.ts). This shell draws one node and has no
// router, so every row is the active node's and opening one sets the shell model's signals.

export function shellNavigation(model: ShellModel, words: () => WorkspaceWords): NavigationHost {
  // A task's project by name, never its id, from the workspaces that list it.
  const projectName = (id: string) =>
    model
      .workspaces()
      .flatMap((workspace) => workspace.projects)
      .find((project) => project.id === id)?.name
  const onActiveNode = <T>(row: T) => ({ ...row, nodeId: activeNodeId() ?? '' })
  return {
    words,
    tasks: () => model.allTasks().map((task) => onActiveNode({ task })),
    taskSubtitle: (task) => task.branch ?? projectName(task.projectId),
    workspaces: () => model.workspaces().map((workspace) => onActiveNode({ workspace })),
    // The open workspace's projects, the same list the shell's own project overlay draws: a project
    // outside it belongs to a workspace this shell is not showing.
    projects: () =>
      words().singular === 'project'
        ? model.workspaces().flatMap((workspace) => workspace.projects)
        : (model.workspace()?.projects ?? []),
    openTask: (row) => activateTaskSignals(row.task),
    // `chooseWorkspace` clears the open task and source, then restores whatever the destination was
    // left on, so there is nothing to do to the rail here.
    openWorkspace: (row) => model.chooseWorkspace(row.workspace.id),
    openProject: (projectId) => {
      if (words().singular === 'project') {
        const workspace = model.workspaces().find((row) => row.projects.some((project) => project.id === projectId))
        if (workspace) model.chooseWorkspace(workspace.id)
      }
      chooseProject(projectId)
    },
  }
}
