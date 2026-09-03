import { createMemo, onCleanup, onMount, type Accessor } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { tasksRoute, type Task } from '@acorn/protocol/api.ts'
import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import { projectsOptions, tasksOptions } from '../../infra/queries'
import { readJson } from '../../infra/node/apiClient'
import { activeNodeId, setActiveNode } from '../../infra/node/activeNode'
import { createFleetQuery } from '../../infra/node/fanout'
import { nodes } from '../../infra/node/fleet'
import { workspaceForProject } from '../../features/workspaces/activeWorkspace'
import { selectFleetWorkspace, type FleetWorkspaceList } from '../../features/workspaces/fleetWorkspaces'
import { activateTaskSignals, pathForTask } from '../../features/tasks/activate'
import { COMMAND_CLOSED, registerCommands, type CommandOutcome } from '../registries/commands/commands'
import { CORE_GO_TO_GROUP, goToGroup } from '../registries/commands/coreCommands'
import { localSearch } from '../registries/commands/localSearch'
import { projectPath } from '../registries/commands/corePaths'

// Go to task, switch workspace, go to project and switch node, as four searches under one group.
//
// These were two row providers until 2026-09-03, and before that they were a special case inside each
// palette: the task and workspace lists were their own kind of palette item, composed into the root by
// hand and invoked through a switch on what kind of thing a row was about. They are ordinary commands
// now, so the root shows four named rows instead of every task the fleet has, and finding one is a
// frame rather than a filter over everything at once
// (docs/future/command-palette/phase-3-settings-and-core-commands.md § Migration steps).
//
// Desktop-only, which is why they are here rather than in the registry folder. All four know the
// router and the fleet fan-out; the terminal draws one node and has neither, so its four are its own
// (apps/tui/src/chrome/navigationCommands.ts). What the two share is the group, the titles and the
// order things happen in when a row is picked.
//
// Every one of them loads once when its frame opens and filters locally afterwards
// (../registries/commands/localSearch.ts): the rows are already in this process, in query caches the
// rest of the shell is reading anyway, so a debounce would be waiting for nothing.

/** The node a fleet row belongs to, and the task it names. Rebuilt per query; the lookup is by both,
 *  because a task id is only unique within a node and this list puts two nodes' ids side by side. */
type FleetTask = { task: Task; nodeId: string }

export function registerNavigationCommands(options: {
  /** The palette's own open flag: the task fan-out runs only while somebody is looking at it. */
  open: Accessor<boolean>
  fleetWorkspaces: Accessor<FleetWorkspaceList>
}): void {
  const navigate = useNavigate()
  const params = useParams()
  const tasks = createQuery(() => tasksOptions(true))
  const projects = createQuery(() => projectsOptions(true))

  // Fanned out only while the palette is open and only when there is more than one node, which is the
  // gate this had before it was a command.
  const fanTasks = (): boolean => options.open() && nodes().length > 1
  const [fleetTasks] = createFleetQuery(
    () => ['tasks', 'palette', 'fleet'] as const,
    async (nodeId, dep: boolean, signal) => (dep ? await readJson<Task[]>(tasksRoute, { nodeId, signal }) : []),
    fanTasks,
  )

  const everyTask = createMemo<FleetTask[]>(() => {
    const active = activeNodeId() ?? ''
    if (!fanTasks()) return (tasks.data ?? []).map((task) => ({ task, nodeId: active }))
    return fleetTasks().rows.flatMap((row) => row.data.map((task) => ({ task, nodeId: row.nodeId })))
  })

  const taskItem = (row: FleetTask): CommandSearchItem => ({
    id: row.task.id,
    title: row.task.title,
    subtitle: row.task.github ? `${row.task.github.owner}/${row.task.github.name}` : row.task.projectId,
    taskId: row.task.id,
  })

  const workspaceEntries = () => options.fleetWorkspaces().entries

  const activeWorkspaceId = (): string | undefined => workspaceForProject(
    workspaceEntries().filter((entry) => entry.nodeId === activeNodeId()).map((entry) => entry.workspace),
    params.projectId,
  )?.id

  onMount(() => {
    const commands = registerCommands([
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
        // Fleet, so the session asks once per node, namespaces each row by the node that answered and
        // carries that node's label into the row. The rows themselves come from one fan-out this
        // window already runs rather than one request per node per keystroke: the answer is in the
        // cache, and the scope is what says which slice of it a target may see.
        scope: 'fleet',
        ...localSearch((context) => everyTask()
          .filter((row) => row.nodeId === (context.nodeId ?? ''))
          // The task this session opened over is the one place the reader already is.
          .filter((row) => !(row.task.id === context.taskId && row.nodeId === (context.nodeId ?? '')))
          .map(taskItem)),
        select: (item, context): CommandOutcome => {
          const row = everyTask().find((candidate) => candidate.task.id === item.id && candidate.nodeId === (context.nodeId ?? ''))
          if (!row) throw new Error('that task is no longer here')
          // The node first: `activateTaskSignals` and the route both resolve against the active node,
          // so a remote task opened without switching addresses the wrong machine.
          if (row.nodeId && row.nodeId !== activeNodeId()) setActiveNode(row.nodeId)
          activateTaskSignals(row.task)
          navigate(pathForTask(row.task))
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
        scope: 'fleet',
        ...localSearch((context) => workspaceEntries()
          .filter((entry) => entry.nodeId === (context.nodeId ?? ''))
          .filter((entry) => !(entry.workspace.id === activeWorkspaceId() && entry.nodeId === (activeNodeId() ?? '')))
          .map((entry): CommandSearchItem => ({
            id: entry.workspace.id,
            title: entry.workspace.name,
            subtitle: `${entry.workspace.projects.length} projects`,
            workspaceId: entry.workspace.id,
          }))),
        select: (item, context): CommandOutcome => {
          const entry = workspaceEntries().find((candidate) =>
            candidate.workspace.id === item.id && candidate.nodeId === (context.nodeId ?? ''))
          if (!entry) throw new Error('that workspace is no longer here')
          // Mirrors the topbar picker, including the node switch
          // (features/workspaces/fleetWorkspaces.ts explains the order). The rail source is restored
          // per-workspace by the activeWorkspace effect in App.tsx.
          selectFleetWorkspace(entry, navigate)
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
        ...localSearch(() => (projects.data ?? [])
          .filter((project) => !project.hidden)
          .map((project): CommandSearchItem => ({
            id: project.id,
            title: project.name,
            ...(project.path ? { subtitle: project.path } : {}),
            projectId: project.id,
          }))),
        select: (item): CommandOutcome => {
          navigate(projectPath(item.id))
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
        // The roster is this device's, not any one node's, so there is no identity to gate on and
        // nothing to fan out to: the list of machines is the same whichever of them is answering.
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
    onCleanup(() => commands.dispose())
  })
}
