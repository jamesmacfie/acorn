import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  clientCapability,
  dispatchLayout,
  localSearch,
  refreshSessions,
  rememberActiveTerminal,
  requestTerminalFocus,
  runApi,
  sessions,
  setTerminalOpen,
  type CommandExecutionContext,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { invokeLayoutRecipe, type RecipeSpec } from './recipes'
import { PREVIEW_RECIPE_SELECTION } from '../contract/previewSelection'

// The three things this plugin knows about the open task: what it can run, how it can be laid out, and
// which terminals are alive in it (docs/terminal.md § From the command palette).
//
// These were a `paletteRows` source until 2026-09-03 — a second contribution vocabulary with `rows` and
// `invoke`, fetched when the palette opened whatever the reader was after, and merged into the root
// beside the commands. They are ordinary `search` commands now, so the root shows three named rows
// instead of one row per target, layout and session, and the fetch happens when a frame is entered
// rather than on every ⌘K.
//
// **Load once, filter here.** The rows are one read of the task's repo configuration and one signal
// this window already holds, so there is nothing for a debounce to wait for: `localSearch` fetches
// when the frame opens and fuzzy-filters locally after that
// (client-core/host/registries/commands/localSearch.ts). A configuration edit shows up the next time a
// frame is entered, which is what the palette did before.
//
// **What the shell and agents keep.** The drawer toggle and the plain shell are the shell's
// (apps/desktop/src/client/TaskView.tsx), and a terminal running a harness CLI is that harness's
// (plugins/agents/src/client/terminalProfileCommands.ts). Neither is repeated here: two rows saying one
// thing is one too many, and cross-owner parenting is refused anyway
// (docs/command-palette-and-shortcuts.md § What the palette refuses).

/** The group these three hang under. Not core's `core.terminal`, which is the drawer and a shell: a
 *  plugin may not parent under another owner's group, and these are about the task's configuration. */
export const TERMINAL_GROUP = 'terminal.run'

/** One `targets` read, kept for the session that asked for it.
 *
 *  Keyed on the captured execution context, which is one object per open palette. So `select` decides
 *  against the very fetch its row was drawn from, and a row from a session over another task cannot
 *  reach this map at all. The old source held one `lastTargets` and compared task ids on the way in,
 *  which is the same guard written after the fact rather than into the shape. */
type Snapshot = {
  targets: { id: string; command: string; running: boolean }[]
  layouts: RecipeSpec[]
  errors: { source: string; message: string }[]
}

const snapshots = new WeakMap<CommandExecutionContext, Promise<Snapshot>>()

const readSnapshot = (context: CommandExecutionContext): Promise<Snapshot> => {
  const cached = snapshots.get(context)
  if (cached) return cached
  const pending = (async (): Promise<Snapshot> => {
    const result = await runApi.targets(context.taskId ?? '')
    // The read itself failed — untrusted repo config, a node that will not answer. Thrown rather than
    // swallowed: the old source answered with no rows at all, so a reader saw an empty list and no
    // reason for it.
    if (!('targets' in result)) throw new Error(result.error)
    return {
      targets: result.targets.map((target) => ({ id: target.id, command: target.command, running: target.running })),
      layouts: result.layouts,
      errors: result.errors ?? [],
    }
  })()
  snapshots.set(context, pending)
  // A failed read is not kept, so Enter on the failure asks again rather than replaying it forever.
  void pending.catch(() => snapshots.delete(context))
  return pending
}

/**
 * A parse error from `.acorn/config.toml`, as a row.
 *
 * The flat palette floated every source's errors to the top of the whole list, because an error
 * explains why a row somebody expected is missing. A frame has no separate error channel for a compiled
 * provider, so the explanation is a row of its own: first, badged, and carrying no `ref`, which is what
 * `select` reads to know it is not a target. Pressing Enter on one restates the message and stays,
 * because there is nothing else it could honestly do.
 */
const problemItem = (error: { source: string; message: string }, at: number): CommandSearchItem => ({
  id: `problem:${at}`,
  title: `${error.source}: ${error.message}`,
  badge: 'error',
})

const problemOutcome = (item: CommandSearchItem): CommandOutcome => ({ effect: 'stay', status: item.title })

export const terminalCommands: readonly ContributedCommand[] = [
  {
    id: TERMINAL_GROUP,
    kind: 'group',
    title: 'Run',
    hint: 'run targets, layout recipes and the terminals in this task',
    category: 'terminal',
    palette: true,
    scope: 'task',
    order: 310,
    requires: { plugin: 'terminal' },
  },
  {
    id: 'terminal.run.targets',
    parentId: TERMINAL_GROUP,
    kind: 'search',
    title: 'Run a target',
    hint: 'start or stop a target from the repo configuration',
    keywords: ['start', 'stop', 'target', 'server'],
    category: 'terminal',
    palette: true,
    scope: 'task',
    order: 100,
    requires: { plugin: 'terminal' },
    placeholder: 'Find a run target…',
    ...localSearch(async (context) => {
      const snapshot = await readSnapshot(context)
      return [
        ...snapshot.errors.map(problemItem),
        ...snapshot.targets.map((target): CommandSearchItem => ({
          id: `target:${target.id}`,
          title: `${target.running ? 'Stop' : 'Run'}: ${target.id}`,
          // The command line, so a target found by what it runs rather than by what it is called is
          // still found: `localSearch` scores the subtitle too.
          subtitle: target.command,
          ...(target.running ? { badge: 'running' } : {}),
          ref: target.id,
        })),
      ]
    }),
    select: async (item, context): Promise<CommandOutcome> => {
      if (!item.ref) return problemOutcome(item)
      const taskId = context.taskId
      if (!taskId) return COMMAND_CLOSED
      // This session's own fetch, not the flag on the row. The row's label is as old as the last time
      // the frame drew, so a target started from somewhere else since then would be started twice.
      const snapshot = await readSnapshot(context)
      const target = snapshot.targets.find((candidate) => candidate.id === item.ref)
      if (!target) throw new Error(`'${item.ref}' is no longer a target of this task`)
      if (target.running) {
        const stopped = await runApi.stop(taskId, target.id)
        if (!stopped.ok) throw new Error(stopped.reason ?? `Unable to stop ${target.id}`)
      } else {
        const started = await runApi.start(taskId, target.id)
        if (!started.ok) throw new Error(started.reason ?? `Unable to start ${target.id}`)
        setTerminalOpen(taskId, true)
      }
      await refreshSessions()
      return COMMAND_CLOSED
    },
  },
  {
    id: 'terminal.run.layouts',
    parentId: TERMINAL_GROUP,
    kind: 'search',
    title: 'Apply a layout',
    hint: 'open the panes a layout recipe names and start its target',
    keywords: ['recipe', 'panes', 'layout'],
    category: 'terminal',
    palette: true,
    scope: 'task',
    order: 200,
    requires: { plugin: 'terminal' },
    placeholder: 'Find a layout…',
    ...localSearch(async (context) => {
      const snapshot = await readSnapshot(context)
      return snapshot.layouts.map((layout): CommandSearchItem => ({
        id: `layout:${layout.id}`,
        title: layout.id,
        subtitle: 'open panes + start target',
        ref: layout.id,
      }))
    }),
    select: async (item, context): Promise<CommandOutcome> => {
      const taskId = context.taskId
      if (!taskId || !item.ref) return COMMAND_CLOSED
      const snapshot = await readSnapshot(context)
      const recipe = snapshot.layouts.find((candidate) => candidate.id === item.ref)
      if (!recipe) throw new Error(`'${item.ref}' is no longer a layout of this task`)
      // The pure executor, with the runtime injected, exactly as the row source wired it (./recipes.ts).
      const result = await invokeLayoutRecipe(taskId, recipe, {
        setLayout: (id, layout) => dispatchLayout(id, { type: 'replace', layout }),
        startTarget: (id, targetId) => runApi.start(id, targetId),
        targetUrl: async (id, targetId) => (await runApi.status(id, targetId)).url,
        setBrowserUrl: async (id, url) => {
          await clientCapability(PREVIEW_RECIPE_SELECTION)?.set(id, url)
        },
        openTerminal: (id) => setTerminalOpen(id, true),
      })
      await refreshSessions()
      if (!result.ok) throw new Error(result.reason ?? `Unable to apply layout ${recipe.id}`)
      return COMMAND_CLOSED
    },
  },
  {
    id: 'terminal.run.sessions',
    parentId: TERMINAL_GROUP,
    kind: 'search',
    title: 'Focus a terminal',
    hint: 'the sessions running in this task',
    keywords: ['session', 'pty', 'shell'],
    category: 'terminal',
    palette: true,
    scope: 'task',
    order: 300,
    requires: { plugin: 'terminal' },
    placeholder: 'Find a terminal…',
    // No fetch at all: the roster is a signal this window already keeps in step with the node
    // (client-core/features/tasks/agentSessions.ts), so the load reads it.
    ...localSearch((context) => sessions()
      .filter((session) => session.taskId === context.taskId)
      .map((session): CommandSearchItem => ({
        id: session.id,
        title: session.title,
        subtitle: session.command,
        ...(session.status === 'exited' ? { badge: 'exited' } : {}),
        ref: session.id,
      }))),
    select: (item, context): CommandOutcome => {
      const taskId = context.taskId
      if (!taskId) return COMMAND_CLOSED
      // The same three calls the notice-target handler makes for a PTY agent (./index.ts): show the
      // drawer, remember which tab this task is on, and ask that tab for the keyboard.
      setTerminalOpen(taskId, true)
      rememberActiveTerminal(taskId, item.id)
      requestTerminalFocus(taskId, item.id)
      return COMMAND_CLOSED
    },
  },
]
