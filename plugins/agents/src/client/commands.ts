import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  setSelectedSource,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { managedAgentApi } from './sessions/managedClient'
import { openManagedSession } from './sessions/managedSelection'

// What this plugin puts in the palette: the rail source it owns, and one search over the managed
// sessions of the open task (docs/managed-agents.md § From the command palette).
//
// The two harness terminals are next door in ./terminalProfileCommands.ts, and the settings the
// catalogue admits are in ./AgentCommands.tsx, which needs a query client and so has to be mounted
// rather than registered at boot.
//
// **Why the search is task-scoped.** The route behind it takes a workspace as happily as a task, and
// Agent Center already asks it that way. But a row from another task can only be opened by activating
// that task first, and activating a task is a navigation this plugin cannot perform: the desktop's
// route change belongs to a router that a plugin has no handle on. A search whose rows cannot all be
// opened is worse than a narrower one, so the palette asks about the task the session captured and
// Agent Center remains the surface that spans them
// (docs/command-palette-and-shortcuts.md).
//
// Stopping, archiving, forking, compacting and handing off are deliberately absent. Each needs a
// selected session and most need a confirmation, which is a result action panel rather than a search
// (docs/command-palette-and-shortcuts.md § What the palette refuses).

/** How many sessions one frame asks the node for. The host caps the rendered set at 50 as well; this
 *  is the provider keeping the same promise on the wire. */
const MAX_SESSION_ROWS = 50

export const agentsCommands: readonly ContributedCommand[] = [
  {
    id: 'source.agents.open',
    title: 'Open Agent Center',
    hint: 'every agent session on this node',
    keywords: ['agents', 'sessions'],
    category: 'navigation',
    palette: true,
    // The rail is this device's view of the node, not a property of any one task or project.
    scope: 'none',
    requires: { plugin: 'agents' },
    run: () => setSelectedSource('agents'),
  },
  {
    id: 'agents.sessions.find',
    kind: 'search',
    title: 'Find an agent session',
    hint: 'the managed sessions of this task, by title and by what was said',
    keywords: ['agent', 'session', 'transcript'],
    category: 'navigation',
    palette: true,
    scope: 'task',
    requires: { plugin: 'agents' },
    placeholder: 'Search agent sessions…',
    // The node's own full-text search over titles, events and artifacts, so the ordering is the
    // provider's rank and the host does not re-rank it. Debounce and minimum query stay at the
    // defaults, because every keystroke here is a request.
    query: async (text, context, signal) => {
      const found = await managedAgentApi.search(
        text,
        { taskId: context.taskId ?? undefined, limit: MAX_SESSION_ROWS },
        { ...(context.nodeId ? { nodeId: context.nodeId } : {}), signal },
      )
      return found.map((session): CommandSearchItem => ({
        id: session.id,
        title: session.title || session.providerId,
        subtitle: session.model ? `${session.providerId} · ${session.model}` : session.providerId,
        ...(session.attention === 'none' ? {} : { badge: session.attention }),
        taskId: session.taskId,
        ref: session.id,
      }))
    },
    select: (item, context): CommandOutcome => {
      const taskId = item.taskId ?? context.taskId
      if (!taskId) return COMMAND_CLOSED
      // The retained selection path the notice targets and Agent Center both use: remember the pick,
      // clear the focused request, and show the pane (./sessions/managedSelection.ts).
      openManagedSession(taskId, item.id)
      return COMMAND_CLOSED
    },
  },
]
