import { createMemo, type Accessor } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { tasksRoute, type Task } from '@acorn/protocol/api.ts'
import { tasksOptions } from '../../infra/queries'
import { readJson } from '../../infra/node/apiClient'
import { activeNodeId, setActiveNode } from '../../infra/node/activeNode'
import { createFleetQuery } from '../../infra/node/fanout'
import { nodes } from '../../infra/node/fleet'
import { workspaceForProject } from '../../features/workspaces/activeWorkspace'
import { selectFleetWorkspace, type FleetWorkspaceList } from '../../features/workspaces/fleetWorkspaces'
import { activateTaskSignals, pathForTask } from '../../features/tasks/activate'
import { COMMAND_CLOSED, type CommandOutcome } from '../registries/commands/commands'
import type { SessionRow, SessionRowProvider } from '../registries/commands/session'

// Go-to-task and switch-workspace, as two row providers for the palette session.
//
// Compatibility, like `registries/palette/provider.ts` beside it: neither of these is a command yet,
// and both become one during the sweep. What they are not is a fork of the session — a provider hands
// back rows and what each row does, and the session owns the query, the cursor and the invocation.
//
// Desktop-only, and that is why they are here rather than in the registry folder. Both know about the
// fleet fan-out and the router; the terminal draws one node and has neither, so its own two providers
// are its own (apps/tui/src/chrome/paletteRows.ts). The rows they produce are the same shape.

/** After the commands, in the order the flat list had: workspaces, then tasks. */
export const WORKSPACE_ROWS_ORDER = 900
export const TASK_ROWS_ORDER = 950

/**
 * Every task the fleet knows, minus the open one, jumpable by name.
 *
 * Keyed `${nodeId}:${taskId}` because a task id is only unique within a node and this list puts two
 * nodes' ids side by side, so a bare task id would make one of two colliding rows unreachable.
 */
export function createTaskRowsProvider(open: Accessor<boolean>): SessionRowProvider {
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  // Fanned out only while the palette is open and only when there is more than one node, which is the
  // gate this had before the session existed.
  const fanTasks = () => open() && nodes().length > 1
  const [fleetTasks] = createFleetQuery(
    () => ['tasks', 'palette', 'fleet'] as const,
    async (nodeId, dep: boolean, signal) => (dep ? await readJson<Task[]>(tasksRoute, { nodeId, signal }) : []),
    fanTasks,
  )

  const fleetTaskRows = createMemo(() => {
    const active = activeNodeId() ?? ''
    if (!fanTasks()) return (tasks.data ?? []).map((task) => ({ task, nodeId: active, nodeLabel: '' }))
    return fleetTasks().rows.flatMap((row) =>
      row.data.map((task) => ({ task, nodeId: row.nodeId, nodeLabel: nodes().length > 1 ? row.node.label : '' })),
    )
  })

  return {
    id: 'tasks',
    order: TASK_ROWS_ORDER,
    rows: (context) => {
      // The captured identity, not the ambient one: the list is "every task but the one this session
      // opened over", and that is what the context says (../registries/commands/commands.ts).
      const current = context.taskId
      const active = context.nodeId ?? ''
      return {
        rows: fleetTaskRows()
          .filter((row) => !(row.task.id === current && row.nodeId === active))
          .map((row): SessionRow => ({
            id: `task:${row.nodeId}:${row.task.id}`,
            label: `Go to task: ${row.task.title}`,
            hint: `${row.task.github ? `${row.task.github.owner}/${row.task.github.name}` : row.task.projectId}${row.nodeLabel ? ` · ${row.nodeLabel}` : ''}`,
            action: {
              effect: 'run',
              run: (): CommandOutcome => {
                // The node first: `activateTaskSignals` and the route both resolve against the active
                // node, so a remote task opened without switching addresses the wrong machine.
                if (row.nodeId && row.nodeId !== activeNodeId()) setActiveNode(row.nodeId)
                activateTaskSignals(row.task)
                navigate(pathForTask(row.task))
                return COMMAND_CLOSED
              },
            },
          })),
      }
    },
  }
}

/**
 * Every workspace on every node except the current one.
 *
 * Same key shape and the same reason as the task rows: two nodes may hold the same workspace UUID.
 */
export function createWorkspaceRowsProvider(fleetWorkspaces: Accessor<FleetWorkspaceList>): SessionRowProvider {
  const navigate = useNavigate()
  const params = useParams()

  return {
    id: 'workspaces',
    order: WORKSPACE_ROWS_ORDER,
    rows: () => {
      const active = workspaceForProject(
        fleetWorkspaces().entries.filter((entry) => entry.nodeId === activeNodeId()).map((entry) => entry.workspace),
        params.projectId,
      )
      const activeNode = activeNodeId() ?? ''
      return {
        rows: fleetWorkspaces().entries
          .filter((entry) => !(entry.workspace.id === active?.id && entry.nodeId === activeNode))
          .map((entry): SessionRow => ({
            id: `workspace:${entry.nodeId}:${entry.workspace.id}`,
            label: `Switch workspace: ${entry.workspace.name}`,
            hint: `${entry.workspace.projects.length} projects${fleetWorkspaces().grouped ? ` · ${entry.node.label}` : ''}`,
            action: {
              effect: 'run',
              run: (): CommandOutcome => {
                // Navigation. Mirrors the topbar picker, including the node switch
                // (features/workspaces/fleetWorkspaces.ts explains the order). The rail source is
                // restored per-workspace by the activeWorkspace effect in App.tsx.
                selectFleetWorkspace(entry, navigate)
                return COMMAND_CLOSED
              },
            },
          })),
      }
    },
  }
}
