import type { CommandScope, CommandSearchItem, CommandSettingOption } from '@acorn/protocol/commands.ts'
import type { HostCapabilityRequirement } from '../../../infra/node/hostCapabilities'
import { hasHostCapability } from '../../../infra/node/hostCapabilities'
import { Registry, type Disposable } from '../../../kit/lib/registry'

// The command vocabulary: what a contributor declares, what a command runs in, and what running one
// says happened (docs/command-palette-and-shortcuts.md).
//
// A command was a flat runnable row until 2026-09-03. It is now a discriminated union, because the
// next contributors are not leaves: a group has children, a search takes a query, an input is
// submitted, and a setting shows its current value
// (docs/future/command-palette/architecture.md § Command graph). The compatibility member carries no
// `kind` at all, so every registration written against the old shape is still exactly the same
// object, and a zero-argument `run` is still assignable to one that is handed a context.
//
// The graph itself — parents, breadcrumbs, inherited availability, root search — is ./graph.ts. This
// file holds the registry, the gates and the executor, and nothing that walks.

export type CommandCategory = 'action' | 'navigation' | 'pane' | 'task' | 'terminal' | 'workspace'

/** Where a sibling with no stated `order` sorts. The number every registry in the repo uses for
 *  "middle", so a contributor who wants to come first or last says so and nobody else has to. */
export const DEFAULT_COMMAND_ORDER = 500

/** Which client captured the context. Absent when nothing did — see `DETACHED_COMMAND_CONTEXT`. */
export type CommandHostKind = 'desktop' | 'tui'

/**
 * The identity a command runs against, captured once when a session opens and never re-read.
 *
 * Captured rather than ambient because a result fetched for one task must not be invoked against
 * another: the session closes when any of these moves under it, and an executor holding this object
 * knows which world it was picked in (docs/future/command-palette/architecture.md § Execution
 * context).
 *
 * Data only. The navigation, pane and fleet adapters the closed chrome actions need arrive with the
 * session that carries them; there is no session yet, so there is nothing here to hand one.
 */
export type CommandExecutionContext = {
  readonly host?: CommandHostKind
  readonly nodeId: string | null
  readonly workspaceId: string | null
  readonly projectId: string | null
  readonly taskId: string | null
  readonly paneId: string | null
  readonly surfaceId: string | null
}

/**
 * No session captured this one: a shortcut, a frame binding, an editor chord.
 *
 * Every identity is absent on purpose. A scoped command reading this must decide it cannot run rather
 * than help itself to whatever the ambient signals happen to say, which is the difference between
 * "the palette picked this task" and "a task happened to be open".
 */
export const DETACHED_COMMAND_CONTEXT: CommandExecutionContext = Object.freeze({
  nodeId: null,
  workspaceId: null,
  projectId: null,
  taskId: null,
  paneId: null,
  surfaceId: null,
})

/**
 * What running a command says happened.
 *
 * `close` is the default and what a leaf action means. `stay` keeps the frame open and may carry a
 * line to show, which is how a setting reports its new value without throwing the reader out of the
 * list. A throw or a rejected promise is neither: it is an error, and the frame stays open with it.
 */
export type CommandOutcome =
  | { effect: 'close' }
  | { effect: 'stay'; status?: string }

export const COMMAND_CLOSED: CommandOutcome = Object.freeze({ effect: 'close' })

/** What an executor may answer with. `void` is the compatibility case and means `close`. */
type CommandResult = void | CommandOutcome | Promise<void | CommandOutcome>

type CommandCommon = {
  id: string
  title: string | (() => string)
  category: CommandCategory
  hint?: string | (() => string | undefined)
  /** Extra words the root search matches on, for a command whose title is not what anyone types. */
  keywords?: readonly string[]
  /** Sibling order, before relevance. `DEFAULT_COMMAND_ORDER` when absent. */
  order?: number
  /** A `group` registered by the same owner. Cross-owner parenting is refused, so a plugin cannot
   *  hang rows inside core's tree or another plugin's (docs/future/command-palette/refused.md). */
  parentId?: string
  /** Discoverable in the palette. A shortcut may still target a command that is not. */
  palette?: boolean
  requires?: HostCapabilityRequirement
  when?: () => boolean
  /** Which identity this needs; `node` when absent (@acorn/protocol/commands.ts). */
  scope?: CommandScope
  /** Who contributed it, stamped by the host. Core's commands have none. A contributor may not state
   *  one: `ContributedCommand` is the type the contribution points take, and it has no such field. */
  ownerId?: string
}

/** A leaf. The compatibility member, so an existing registration with no `kind` is one of these. */
export type ActionCommand = CommandCommon & {
  kind?: 'action'
  run: (context: CommandExecutionContext) => CommandResult
}

/** A parent. No executor: its children are the commands naming it as their `parentId`. */
export type GroupCommand = CommandCommon & { kind: 'group' }

/** A live query. `query` is debounced and cancellable; `select` owns what picking a row does. */
export type SearchCommand = CommandCommon & {
  kind: 'search'
  placeholder?: string
  minQueryLength?: number
  debounceMs?: number
  query: (text: string, context: CommandExecutionContext, signal: AbortSignal) => Promise<readonly CommandSearchItem[]>
  select: (item: CommandSearchItem, context: CommandExecutionContext) => CommandResult
}

/** A submitted line. Never debounced: the reader presses Enter once and waits. `validate` answers a
 *  message when the text is not submittable, and nothing when it is. */
export type InputCommand = CommandCommon & {
  kind: 'input'
  placeholder?: string
  validate?: (text: string) => string | undefined
  submit: (text: string, context: CommandExecutionContext, signal: AbortSignal) => CommandResult
}

/** A bounded choice with its current value shown. `write` answers the canonical value it stored, so a
 *  provider that normalises what it was given still leaves the list marking the right row. */
export type SettingCommand = CommandCommon & {
  kind: 'setting'
  read: (context: CommandExecutionContext, signal: AbortSignal) => Promise<string>
  options: readonly CommandSettingOption[]
  write: (value: string, context: CommandExecutionContext, signal: AbortSignal) => Promise<string>
}

export type CommandContribution = ActionCommand | GroupCommand | SearchCommand | InputCommand | SettingCommand

// Distributive, so the union survives. A bare `Omit` over a union collapses it into one member with
// the fields they all share, which would take `run`, `query` and `submit` with it.
type WithoutOwner<T> = T extends unknown ? Omit<T, 'ownerId'> : never

/** What a contributor declares: a command minus the owner, which is the host's to stamp. The
 *  contribution points take this rather than `CommandContribution`, so a plugin naming an owner is a
 *  type error rather than a silent overwrite. */
export type ContributedCommand = WithoutOwner<CommandContribution>

export const commandRegistry = new Registry<CommandContribution>('command')

export const commandTitle = (command: CommandContribution): string =>
  typeof command.title === 'function' ? command.title() : command.title
export const commandHint = (command: CommandContribution): string | undefined =>
  typeof command.hint === 'function' ? command.hint() : command.hint

/** This command's own two gates, and only its own. An ancestor's availability is inherited by the
 *  projection rather than by this function, because a bare registry entry has no parent to ask
 *  (./graph.ts). */
export const commandAvailable = (command: CommandContribution): boolean =>
  hasHostCapability(command.requires) && (command.when?.() ?? true)

/** A leaf that `executeCommand` can run. Everything else is entered rather than run. */
export const isActionCommand = (command: CommandContribution): command is ActionCommand =>
  command.kind === undefined || command.kind === 'action'

/** The owner is the host's word, never the contributor's: a plugin that could state one could claim
 *  another plugin's group as its parent. */
export const stampCommandOwner = (command: ContributedCommand, ownerId: string): CommandContribution =>
  ({ ...command, ownerId })

/**
 * Run a leaf action and say what happened.
 *
 * The context is optional because most callers have none — a shortcut, a frame binding, an editor
 * chord — and they get `DETACHED_COMMAND_CONTEXT`, which states that rather than pretending.
 *
 * A `void` answer normalises to `close`, so every registration written before there was an outcome
 * still means what it meant. An absent or unavailable command also answers `close`: nothing ran, and
 * a palette that opened over it has nothing to keep itself open for.
 *
 * A throw becomes a rejection rather than escaping synchronously. Every caller already writes
 * `.catch`, and before this a command that threw on its way in went past all of them and into the key
 * dispatcher.
 */
export function executeCommand(id: string, context?: CommandExecutionContext): Promise<CommandOutcome> {
  const command = commandRegistry.get(id)
  if (!command || !commandAvailable(command)) return Promise.resolve(COMMAND_CLOSED)
  // An interactive command is entered at its own frame, and the session that enters one is not built
  // yet. `stay` is the honest answer meanwhile: nothing ran, so nothing should close over it.
  if (!isActionCommand(command)) return Promise.resolve({ effect: 'stay' })
  try {
    return Promise.resolve(command.run(context ?? DETACHED_COMMAND_CONTEXT))
      .then((outcome) => outcome ?? COMMAND_CLOSED)
  } catch (error) {
    return Promise.reject(error)
  }
}

export function registerCommands(commands: readonly CommandContribution[]): Disposable {
  const disposables = commands.map((command) => commandRegistry.register(command))
  return { dispose: () => [...disposables].reverse().forEach((disposable) => disposable.dispose()) }
}
