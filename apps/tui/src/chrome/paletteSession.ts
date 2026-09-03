import {
  COMMAND_CLOSED, type CommandExecutionContext, type CommandOutcome,
} from '@acorn/client-core/host/registries/commands/commands.ts'
import {
  createCommandSession, type CommandSession, type SessionRow, type SessionRowProvider,
} from '@acorn/client-core/host/registries/commands/session.ts'
import { createPaletteRowsProvider } from '@acorn/client-core/host/registries/palette/provider.ts'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { activeTaskId, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { closeOverlay, openOverlay } from './state'
import type { ShellModel } from './model'

// The terminal's half of the palette: which identity a session captures here, and the two row
// providers this host can produce.
//
// The session is client-core's and both hosts run the same one
// (client-core/host/registries/commands/session.ts). It owns the query, the order, the cursor and the
// invocation. What the shell owns is what a terminal answers differently: the overlay stack is where
// "open" and "closed" live, because there is no window to float a dialog over.
//
// Go-to-task and switch-workspace are below, and the desktop has two of its own
// (client-core/host/palette/navigationRows.ts). They are not shared because they are not the same
// question: its rows carry a node id and picking one navigates a router, because its list spans the
// fleet. This host draws one node and has no router, so a task is its bare id and picking one sets the
// signals. The rows they hand the session are the same shape, which is the part that matters. Both are
// compatibility and both go when their rows become commands.

/** After the commands, in the order the flat list had: workspaces, then tasks. Same numbers as the
 *  desktop's, because it is the same list in a different rectangle. */
export const WORKSPACE_ROWS_ORDER = 900
export const TASK_ROWS_ORDER = 950

/**
 * The shell's one session, built where the shell is and handed to `./Palette.tsx` to draw.
 *
 * Not inside the component, because the component is mounted only while the overlay is open and the
 * session has to exist before that: a shortcut aimed at a group asks the session to open at it
 * (client-core/host/registries/commands/presenter.ts), and there is nothing to ask if the palette has
 * to be open already.
 */
export function createShellPalette(model: ShellModel): CommandSession {
  const context = (): CommandExecutionContext => ({
    host: 'tui',
    nodeId: activeNodeId() ?? null,
    workspaceId: model.workspace()?.id ?? null,
    projectId: model.task()?.projectId ?? null,
    taskId: activeTaskId() ?? null,
    paneId: null,
    surfaceId: null,
  })
  const providers = [
    createPaletteRowsProvider(),
    createWorkspaceRowsProvider(model),
    createTaskRowsProvider(model),
  ]
  return createCommandSession({
    context,
    providers: () => providers,
    onOpen: () => openOverlay('palette'),
    onClose: () => closeOverlay('palette'),
  })
}

export function createTaskRowsProvider(model: ShellModel): SessionRowProvider {
  return {
    id: 'tasks',
    order: TASK_ROWS_ORDER,
    rows: (context) => ({
      rows: model.allTasks()
        .filter((task) => task.id !== context.taskId)
        .map((task): SessionRow => ({
          id: `task:${task.id}`,
          label: `Go to task: ${task.title}`,
          hint: task.branch ?? task.projectId,
          action: {
            effect: 'run',
            run: (): CommandOutcome => {
              activateTaskSignals(task)
              return COMMAND_CLOSED
            },
          },
        })),
    }),
  }
}

export function createWorkspaceRowsProvider(model: ShellModel): SessionRowProvider {
  return {
    id: 'workspaces',
    order: WORKSPACE_ROWS_ORDER,
    rows: (context) => ({
      rows: model.workspaces()
        .filter((workspace) => workspace.id !== context.workspaceId)
        .map((workspace): SessionRow => ({
          id: `workspace:${workspace.id}`,
          label: `Switch workspace: ${workspace.name}`,
          hint: `${workspace.projects.length} projects`,
          action: {
            effect: 'run',
            run: (): CommandOutcome => {
              model.chooseWorkspace(workspace.id)
              // The rail goes back to following the task, which is what choosing a workspace from
              // anywhere else does (./Rail.tsx).
              setSelectedSource(null)
              return COMMAND_CLOSED
            },
          },
        })),
    }),
  }
}
