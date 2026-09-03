import {
  type CommandExecutionContext,
} from '@acorn/client-core/host/registries/commands/commands.ts'
import {
  createCommandSession, type CommandSession,
} from '@acorn/client-core/host/registries/commands/session.ts'
import { createPaletteRowsProvider } from '@acorn/client-core/host/registries/palette/provider.ts'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { activeTaskId } from '@acorn/client-core/features/tasks/tasks.ts'
import { closeOverlay, openOverlay } from './state'
import type { ShellModel } from './model'

// The terminal's half of the palette: which identity a session captures here, and the one row provider
// this host still has.
//
// The session is client-core's and both hosts run the same one
// (client-core/host/registries/commands/session.ts). It owns the query, the order, the cursor and the
// invocation. What the shell owns is what a terminal answers differently: the overlay stack is where
// "open" and "closed" live, because there is no window to float a dialog over.
//
// Go-to-task and switch-workspace used to be two row providers here. They are commands now
// (./navigationCommands.ts), so the only compatibility provider left is the `paletteRows` one, which
// goes when its last contributor becomes a command
// (docs/future/command-palette/phase-6-cutover-and-documentation.md).

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
  const providers = [createPaletteRowsProvider()]
  return createCommandSession({
    context,
    providers: () => providers,
    onOpen: () => openOverlay('palette'),
    onClose: () => closeOverlay('palette'),
  })
}
