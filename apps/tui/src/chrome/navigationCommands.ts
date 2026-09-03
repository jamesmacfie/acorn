import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED, registerCommands, type CommandOutcome,
} from '@acorn/client-core/host/registries/commands/commands.ts'
import { CORE_GO_TO_GROUP, goToGroup } from '@acorn/client-core/host/registries/commands/coreCommands.ts'
import { localSearch } from '@acorn/client-core/host/registries/commands/localSearch.ts'
import { activeNodeId, setActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
import { nodes } from '@acorn/client-core/infra/node/fleet.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import type { Disposable } from '@acorn/client-core/kit/lib/registry.ts'
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
// by hand (docs/future/command-palette/phase-3-settings-and-core-commands.md § Migration steps).
//
// Each loads once when its frame opens and filters locally after that
// (client-core/host/registries/commands/localSearch.ts): every row is already in this process.

export function registerNavigationCommands(model: ShellModel): Disposable {
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
          subtitle: task.branch ?? task.projectId,
          taskId: task.id,
        }))),
      select: (item): CommandOutcome => {
        const task = model.allTasks().find((candidate) => candidate.id === item.id)
        if (!task) throw new Error('that task is no longer here')
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
          subtitle: `${workspace.projects.length} projects`,
          workspaceId: workspace.id,
        }))),
      select: (item): CommandOutcome => {
        model.chooseWorkspace(item.id)
        // The rail goes back to following the task, which is what choosing a workspace from anywhere
        // else does (./Rail.tsx).
        setSelectedSource(null)
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
        .map((project): CommandSearchItem => ({ id: project.id, title: project.name, projectId: project.id }))),
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
        .map((node): CommandSearchItem => ({ id: node.nodeId, title: node.label }))),
      select: (item): CommandOutcome => {
        setActiveNode(item.id)
        return COMMAND_CLOSED
      },
    },
  ])
}
