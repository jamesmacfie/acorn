import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  localSearch,
  setSelectedSource,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { managedAgentApi } from './sessions/managedClient'
import { openManagedSession, requestComposerFocus } from './sessions/managedSelection'
import { managedAgentStore } from './sessions/managedStore'

// What this plugin puts in the palette: the rail source it owns, a way to start a session in the open
// task, and one search over that task's managed sessions
// (docs/managed-agents.md § From the command palette).
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
    id: 'agents.sessions.new',
    kind: 'search',
    title: 'New agent session',
    hint: 'start a managed session in this task',
    keywords: ['agent', 'new', 'start', 'session', 'harness'],
    category: 'action',
    palette: true,
    // A session is created against a task worktree, so with no task open there is nothing to start one
    // in and the palette hides the row rather than offering one that can only fail.
    scope: 'task',
    requires: { plugin: 'agents' },
    placeholder: 'Pick a harness…',
    // The pane's New picker as a palette row: the providers this node runs, read once when the frame
    // opens and filtered here, because that list does not move while somebody types
    // (client-core localSearch.ts). Only the installed ones — an absent CLI cannot start a session, and
    // the pane's cards are where the diagnostic that says why belongs.
    ...localSearch(async () => (await managedAgentApi.providers())
      .filter((provider) => provider.installed)
      .map((provider): CommandSearchItem => ({
        id: provider.id,
        title: provider.label,
        subtitle: provider.executableVersion ?? 'Available',
        ...(provider.glyph ? { icon: provider.glyph } : {}),
        // The profile the session runs under. The row carries it because a picked row is all `select`
        // gets, and the two ids differ for a provider that ships more than one profile.
        ref: provider.profileId,
      }))),
    select: async (item, context) => {
      const taskId = context.taskId
      if (!taskId) return COMMAND_CLOSED
      // Not caught: a failed create leaves the frame open with the reason, which is the only place a
      // palette pick has to say anything. The pane loads the transcript when the selection lands on it.
      const session = await managedAgentStore.startSession(taskId, { id: item.id, profileId: item.ref ?? item.id })
      openManagedSession(taskId, session.id)
      requestComposerFocus(session.id)
      return COMMAND_CLOSED
    },
  },
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
