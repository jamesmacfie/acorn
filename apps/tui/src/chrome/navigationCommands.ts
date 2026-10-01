import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED, registerCommands, type CommandOutcome,
} from '@acorn/client-core/host/registries/commands'
import { CORE_GO_TO_GROUP, goToGroup } from '@acorn/client-core/host/registries/commands'
import { localSearch } from '@acorn/client-core/host/registries/commands'
import { activeNodeId, setActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
import { nodes } from '@acorn/client-core/infra/node/fleet.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { previousWorkspaceId } from '@acorn/client-core/features/workspaces'
import type { Disposable } from '@acorn/client-core/kit/lib'
import { chooseProject } from './routing'
import type { ShellModel } from './model'

// Go to task, switch workspace, go to project and switch node, as four searches under one group.
//
// The desktop's four are `client-core/host/palette/navigationCommands.ts`, and they are deliberately
// not shared: its rows carry a node id and picking one navigates a router, because its list spans the
// fleet. This host draws one node and has no router, so a task is its bare id and picking one sets the
// signals. What the two do share is the group, the titles and the order things happen in — which is the
// part a reader moving between the two notices.
//
// These replace the two row providers this shell used to hand the session, which were the last of the
// palette's special cases: a task and a workspace were their own kind of item, composed into the root
// by hand (docs/command-palette-and-shortcuts.md).
//
// These rosters can arrive after the palette opens, so the shell retries the current search when
// they change. Each query still filters locally (client-core/host/registries/commands/localSearch.ts).

export function registerNavigationCommands(model: ShellModel): Disposable {
  // A task's project by name, never its id, from the workspaces that list it.
  const projectName = (id: string) => model.workspaces().flatMap((workspace) => workspace.projects).find((project) => project.id === id)?.name
  return registerCommands([
    goToGroup(),
    {
      id: 'core.goto.task',
      parentId: CORE_GO_TO_GROUP,
      kind: 'search',
      title: 'Go to task',
      category: 'navigation',
      palette: true,
      order: 100,
      placeholder: 'Find a task…',
      ...localSearch((context) => model.allTasks()
        .filter((task) => task.id !== context.taskId)
        .map((task): CommandSearchItem => ({
          id: task.id,
          title: task.title,
          subtitle: task.branch ?? projectName(task.projectId),
          taskId: task.id,
        })), { cache: false }),
      select: (item): CommandOutcome => {
        const task = model.allTasks().find((candidate) => candidate.id === item.id)
        if (!task) throw new Error("That task isn't here any more.")
        activateTaskSignals(task)
        return COMMAND_CLOSED
      },
    },
    {
      id: 'core.goto.workspace',
      parentId: CORE_GO_TO_GROUP,
      kind: 'search',
      title: 'Switch workspace',
      category: 'workspace',
      palette: true,
      order: 200,
      placeholder: 'Find a workspace…',
      ...localSearch((context) => model.workspaces()
        .filter((workspace) => workspace.id !== context.workspaceId)
        .map((workspace): CommandSearchItem => ({
          id: workspace.id,
          title: workspace.name,
          subtitle: `${workspace.projects.length} project${workspace.projects.length === 1 ? '' : 's'}`,
          workspaceId: workspace.id,
        })), { cache: false }),
      select: (item): CommandOutcome => {
        // `chooseWorkspace` clears the open task and source and then restores whatever the
        // destination was left on, so there is nothing to do to the rail here. Clearing the source
        // after the call threw that restore away and sent every palette switch to the default.
        model.chooseWorkspace(item.id)
        return COMMAND_CLOSED
      },
    },
    {
      id: 'core.goto.workspace-last',
      parentId: CORE_GO_TO_GROUP,
      title: 'Last workspace',
      hint: 'back to the workspace you came from',
      category: 'workspace',
      palette: true,
      order: 250,
      scope: 'none',
      when: () => !!previousWorkspaceId(),
      run: (): CommandOutcome => {
        const id = previousWorkspaceId()
        if (!id) throw new Error('there is no workspace to go back to')
        // Nothing to do to the rail, same as the search above.
        model.chooseWorkspace(id)
        return COMMAND_CLOSED
      },
    },
    {
      id: 'core.goto.project',
      parentId: CORE_GO_TO_GROUP,
      kind: 'search',
      title: 'Go to project',
      hint: 'open a project without opening a task',
      category: 'navigation',
      palette: true,
      order: 300,
      placeholder: 'Find a project…',
      // The open workspace's projects, which is the same list the shell's own project overlay draws:
      // a project outside it belongs to a workspace this shell is not showing.
      ...localSearch(() => (model.workspace()?.projects ?? [])
        .map((project): CommandSearchItem => ({ id: project.id, title: project.name, projectId: project.id })), { cache: false }),
      select: (item): CommandOutcome => {
        chooseProject(item.id)
        return COMMAND_CLOSED
      },
    },
    {
      id: 'core.goto.node',
      parentId: CORE_GO_TO_GROUP,
      kind: 'search',
      title: 'Switch node',
      category: 'navigation',
      palette: true,
      order: 400,
      placeholder: 'Find a node…',
      // The roster is this device's, not any one node's, so there is no identity to gate on.
      scope: 'none',
      when: () => nodes().length > 1,
      ...localSearch(() => nodes()
        .filter((node) => node.nodeId !== activeNodeId())
        .map((node): CommandSearchItem => ({ id: node.nodeId, title: node.label })), { cache: false }),
      select: (item): CommandOutcome => {
        setActiveNode(item.id)
        return COMMAND_CLOSED
      },
    },
  ])
}
