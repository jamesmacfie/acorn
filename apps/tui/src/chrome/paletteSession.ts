import {
  type CommandExecutionContext,
} from '@acorn/client-core/host/registries/commands/commands.ts'
import {
  createCommandSession, type CommandSession,
} from '@acorn/client-core/host/registries/commands/session.ts'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { activeTaskId } from '@acorn/client-core/features/tasks/tasks.ts'
import { useNavigate } from '../kit/router'
import { routedProjectId } from './routing'
import { closeOverlay, openOverlay } from './state'
import type { ShellModel } from './model'

// The terminal's half of the palette: which identity a session captures here, and nothing else.
//
// The session is client-core's and both hosts run the same one
// (client-core/host/registries/commands/session.ts). It owns the query, the order, the cursor and the
// invocation. What the shell owns is what a terminal answers differently: the overlay stack is where
// "open" and "closed" live, because there is no window to float a dialog over.
//
// This host handed the session row providers until 2026-09-03 — go-to-task and switch-workspace, then
// the `paletteRows` contributions after those two became commands (./navigationCommands.ts). There is
// no such seam left on either host: every row in the palette comes from the command registry.

/**
 * The shell's one session, built where the shell is and handed to `./Palette.tsx` to draw.
 *
 * Not inside the component, because the component is mounted only while the overlay is open and the
 * session has to exist before that: a shortcut aimed at a group asks the session to open at it
 * (client-core/host/registries/commands/presenter.ts), and there is nothing to ask if the palette has
 * to be open already.
 */
export function createShellPalette(model: ShellModel): CommandSession {
  const navigate = useNavigate()
  const context = (): CommandExecutionContext => ({
    host: 'tui',
    nodeId: activeNodeId() ?? null,
    workspaceId: model.workspace()?.id ?? null,
    // The routed project, not the open task's, which is what the desktop captures
    // (client-core/host/palette/CommandPalette.tsx reads `params.projectId`). A project-scoped command
    // asks "which project is on screen", and answering it from a task would offer a project search on
    // a route that shows no project list to navigate within.
    projectId: routedProjectId(),
    taskId: activeTaskId() ?? null,
    paneId: null,
    surfaceId: null,
    // Same as the desktop's: the shell's navigator, for a closed chrome verb that addresses a URL
    // rather than a task's layout (../kit/router.ts).
    navigate,
  })
  return createCommandSession({
    context,
    onOpen: () => openOverlay('palette'),
    onClose: () => closeOverlay('palette'),
  })
}
