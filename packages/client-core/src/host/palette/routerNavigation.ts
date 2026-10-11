import { createMemo, type Accessor } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate } from '@solidjs/router'
import { tasksRoute, type Task } from '@acorn/protocol/api.ts'
import { projectsOptions, tasksOptions } from '../../infra/queries'
import { readJson } from '../../infra/node/apiClient'
import { activeNodeId, setActiveNode } from '../../infra/node/activeNode'
import { createFleetQuery } from '../../infra/node/fanout'
import { nodes } from '../../infra/node/fleet'
import { selectFleetWorkspace, type FleetWorkspaceList } from '../../features/workspaces/fleetWorkspaces'
import { createWorkspaceWords } from '../../features/workspaces/words'
import { activateTaskSignals, pathForTask } from '../../features/tasks/activate'
import type { NavigationHost, NavigationTask } from '../registries/commands/navigationCommands'
import { projectPath } from '../registries/commands/corePaths'

// The desktop's half of the Go to commands (../registries/commands/navigationCommands.ts): rows from
// across the fleet, and a router to open them with. Called inside the router, because both reads and
// the navigator need its context.

export function createRouterNavigation(options: {
  /** The palette's own open flag: the task fan-out runs only while somebody is looking at it. */
  open: Accessor<boolean>
  fleetWorkspaces: Accessor<FleetWorkspaceList>
}): NavigationHost {
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const projects = createQuery(() => projectsOptions(true))

  // Fanned out only while the palette is open and only when there is more than one node.
  const fanTasks = (): boolean => options.open() && nodes().length > 1
  const [fleetTasks] = createFleetQuery(
    () => ['tasks', 'palette', 'fleet'] as const,
    async (nodeId, dep: boolean, signal) => (dep ? await readJson<Task[]>(tasksRoute, { nodeId, signal }) : []),
    fanTasks,
  )
  const everyTask = createMemo<NavigationTask[]>(() => {
    const active = activeNodeId() ?? ''
    if (!fanTasks()) return (tasks.data ?? []).map((task) => ({ task, nodeId: active }))
    return fleetTasks().rows.flatMap((row) => row.data.map((task) => ({ task, nodeId: row.nodeId })))
  })

  return {
    words: createWorkspaceWords(),
    tasks: everyTask,
    // The project's name, never its id. A task from another node's project is not in this node's
    // list, and it gets no subtitle rather than a UUID.
    taskSubtitle: (task) =>
      task.github
        ? `${task.github.owner}/${task.github.name}`
        : projects.data?.find((project) => project.id === task.projectId)?.name,
    workspaces: () => options.fleetWorkspaces().entries,
    projects: () => (projects.data ?? []).filter((project) => !project.hidden),
    openTask: (row) => {
      // The node first: `activateTaskSignals` and the route both resolve against the active node, so a
      // remote task opened without switching addresses the wrong machine.
      if (row.nodeId && row.nodeId !== activeNodeId()) setActiveNode(row.nodeId)
      activateTaskSignals(row.task)
      navigate(pathForTask(row.task))
    },
    // Mirrors the topbar picker, node switch included (features/workspaces/fleetWorkspaces.ts). The
    // rail source is restored per workspace by the activeWorkspace effect in App.tsx.
    openWorkspace: (row) => selectFleetWorkspace(row, navigate),
    openProject: (projectId) => navigate(projectPath(projectId)),
  }
}
