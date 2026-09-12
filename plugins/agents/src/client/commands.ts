import { createEffect, createMemo, onCleanup } from 'solid-js'
import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  localSearch,
  registerCommands,
  setSelectedSource,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import type { AgentPaneModel, SessionAction } from './sessions/agentPaneModel'
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
// Stopping is deliberately absent: it is the one destructive verb here, and it needs the runtime
// state a low-context row cannot carry (docs/command-palette-and-shortcuts.md § What the palette
// refuses). The rest of the open session's menu is at the bottom of this file, registered by the pane
// while it is on screen rather than at boot.

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

// ── The open session's own actions ────────────────────────────────────────────────────────────────

/** The group every mirrored action hangs under, so the root shows one row rather than ten. */
const SESSION_GROUP = 'agents.session'

/**
 * Mirror the open session's `•••` menu into the palette for as long as the pane is on screen.
 *
 * Registered from the detail region rather than at boot, and that is the whole point of it. These
 * actions need a selected session, which only the pane model has; two of them — rename and archive —
 * are dialogs that region draws, so a row offered while it is unmounted would run and show nothing.
 * Mounted is therefore the honest gate: you can reach these when you are looking at the run they are
 * about (docs/managed-agents.md § From the command palette).
 *
 * The pane model stays the only place the roster is written. Nothing is enumerated here — the labels,
 * the availability and the work are all read back out of `sessionActions()` at the moment the row is
 * drawn or picked, so a session that gains an action gains a command with it.
 */
export function registerSessionActionCommands(model: AgentPaneModel): void {
  const live = (id: string): SessionAction | undefined =>
    model.sessionActions().find((action) => action.id === id)
  // Which actions exist changes with the session, the provider and the last turn; their labels and
  // their disabled flag do not need a re-registration, because a command reads both through `live`.
  // So this notifies on the id set alone, and typing in the palette does not race a re-register.
  const roster = createMemo(() => model.sessionActions(), [] as readonly SessionAction[], {
    equals: (before, after) =>
      before.map((action) => action.id).join() === after.map((action) => action.id).join(),
  })
  createEffect(() => {
    const actions = roster()
    if (actions.length === 0) return
    const registered = registerCommands([
      {
        id: SESSION_GROUP,
        kind: 'group',
        title: 'Agent session',
        hint: 'what the open session’s ••• menu does',
        keywords: ['agent', 'session'],
        category: 'action',
        palette: true,
        scope: 'task',
        requires: { plugin: 'agents' },
      },
      ...actions.map((action): ContributedCommand => ({
        id: `${SESSION_GROUP}.${action.id}`,
        parentId: SESSION_GROUP,
        // Read live, so a row renamed by the session it is about says the right thing. The breadcrumb
        // the group gives it is what a root search for "agent" matches on, so no keywords here.
        title: () => live(action.id)?.label ?? action.label,
        hint: () => live(action.id)?.description,
        category: 'action',
        palette: true,
        scope: 'task',
        requires: { plugin: 'agents' },
        // The menu draws a disabled row with the reason on it; the palette has nowhere to put that,
        // so an action that cannot run is not offered.
        when: () => {
          const found = live(action.id)
          return !!found && !found.disabled
        },
        run: () => live(action.id)?.run(),
      })),
    ])
    onCleanup(() => registered.dispose())
  })
}
