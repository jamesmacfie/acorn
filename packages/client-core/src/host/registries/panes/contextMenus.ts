// The context-menu registry: what a right-click offers, contributed rather than written inline
// (docs/plugins/menus-and-markers.md § Context menus).
//
// This module holds no JSX import (docs/frontend/registries.md § Registries and plugins): the host that draws
// these rows lives in `./contextMenuHost.tsx`, a `<For>` over `contextMenuItems()`.
import {
  fileExtensionFact,
  matchesWhen,
  type ContextMenuLocation,
  type SelectionContentKind,
} from '@acorn/protocol/contextMenus.ts'
import { Registry } from '../../../kit/lib/state/registry'
import { createLogger } from '../../../infra/telemetry/logger'
import { sourceRegistry } from '../sources/sources'
import { paneRegistry } from './panes'

const log = createLogger('context-menu')

export type { ContextMenuLocation }

/**
 * What is under the cursor, as the host describes it. Every fact is a flat scalar on purpose: a
 * declared `when` is a map of literals compared against these fields, so a nested value would be a
 * fact no manifest could name.
 *
 * The fields a `when` may name are the ones in `CONTEXT_MENU_FACTS`, a strict subset: `id` and
 * `title` are the item's payload, not a predicate.
 */
export type TaskRowTarget = {
  location: 'task.row'
  id: string
  title: string
  origin: string
  projectId: string
  pinned: boolean
  branch: string | null
}

/**
 * A row in an integration's list: a Rollbar error, a Linear issue, a GitHub pull request.
 *
 * `item` is the provider's own row, handed back untouched to whoever contributed the action, which is
 * how one registry serves three lists that agree on nothing else. It is not a fact, so no `when` can
 * name it. `title`, `body` and `link` are the three things every tracker has and the three the
 * workflow prefill reads (docs/workflows/starting-runs.md § Starting a run).
 */
export type ItemRowTarget = {
  location: 'item.row'
  id: string
  title: string
  providerId: string
  projectId: string
  body?: string
  link?: string
  item: unknown
}

export type RailSourceTarget = {
  location: 'rail.source'
  id: string
  title: string
  nodeId: string
  projectId: string
}

export type RailPaneTarget = {
  location: 'rail.pane'
  id: string
  title: string
  nodeId: string
  taskId: string
  projectId: string
  pinned: boolean
  shown: boolean
}

/**
 * A file or folder, from the plugin that draws it: a row in Editor's tree (`file.row`) or an open
 * document's tab (`document.tab`). Any plugin may add a row here, so the owner and the bound Node and
 * task travel with the target and the host rechecks them before a contributed action runs.
 *
 * `path` is the owner's own confined worktree-relative path, case kept, never a basename matched back
 * to a file. `title` is what the owner shows. `revision` is the disk version the owner last saw, when
 * it has one. None of the three is a fact.
 */
export type FileMenuTarget<L extends 'file.row' | 'document.tab' = 'file.row' | 'document.tab'> = {
  location: L
  nodeId: string
  ownerPluginId: string
  taskId: string
  projectId: string
  path: string
  title: string
  directory: boolean
  readOnly: boolean
  /** Derived from `path`, so a manifest can match a file kind. Built by `fileMenuTarget`. */
  extension: string
  revision?: string
}
export type FileRowTarget = FileMenuTarget<'file.row'>
export type DocumentTabTarget = FileMenuTarget<'document.tab'>

/** A file target with its `extension` fact derived from the path, so no owner computes it its own way. */
export const fileMenuTarget = <L extends 'file.row' | 'document.tab'>(
  location: L,
  fields: Omit<FileMenuTarget<L>, 'location' | 'extension'>,
): FileMenuTarget<L> => ({ location, ...fields, extension: fileExtensionFact(fields.path, fields.directory) })

/**
 * A user or assistant message in an agent transcript (`agent.message`). Any plugin may add a row, so the
 * bound Node, task and session travel with it and the host rechecks them before a row runs.
 *
 * `itemId` is the transcript card's stable id, `status` the status of the turn the message belongs to,
 * and `revision` the sequence number of the newest event behind the card, so a message that streamed on
 * after the menu opened reads as changed. `text` is what the card shows, cut to 64 KiB, with
 * `textTruncated` set when it was cut. Only `role`, `status` and `projectId` are facts.
 */
export type AgentMessageTarget = {
  location: 'agent.message'
  nodeId: string
  taskId: string
  projectId: string
  sessionId: string
  itemId: string
  turnId: string
  role: 'user' | 'assistant'
  status: string
  text: string
  textTruncated?: true
  revision: number
}

/** A finished turn in an agent transcript (`agent.turn`): completed, failed, cancelled or interrupted.
 *  A turn still running, waiting on an answer or queued has no target. `revision` is the sequence number
 *  of the event that closed it. */
export type AgentTurnTarget = {
  location: 'agent.turn'
  nodeId: string
  taskId: string
  projectId: string
  sessionId: string
  turnId: string
  status: string
  revision: number
}

/** Where a selection's line and column are in its document: one-based, with an exclusive end, the way
 *  the owner counts them. Only an editor's document selection has one. */
export type SelectionRange = { start: { line: number; column: number }; end: { line: number; column: number } }

/**
 * Text a person selected in host-drawn content and asked for actions on (`content.selection`). Taken
 * once, when the menu opens, never as the selection changes. See docs/plugins/menus-and-markers.md §
 * Context menus.
 *
 * `ownerId` is the plugin that draws the content. `revision` is the owner's version of it: the newest
 * event behind a transcript message, or an editor's live-buffer edit counter. The owner refuses a row
 * once it has moved on. `resource` names what the text came from when the owner knows: a file in the
 * task's worktree, or a transcript message. Rendered Markdown carries the plain text selected and no
 * source offsets, so `range` is only ever a document's. Only `contentKind`, `languageId` and
 * `readOnly` are facts.
 */
export type ContentSelectionTarget = {
  location: 'content.selection'
  nodeId: string
  taskId?: string
  projectId?: string
  ownerId: string
  contentKind: SelectionContentKind
  languageId?: string
  readOnly: boolean
  text: string
  revision: number
  resource?: { kind: 'file'; path: string } | { kind: 'message'; sessionId: string; itemId: string }
  range?: SelectionRange
}

export type ContextMenuTarget =
  | TaskRowTarget
  | ItemRowTarget
  | RailSourceTarget
  | RailPaneTarget
  | FileRowTarget
  | DocumentTabTarget
  | AgentMessageTarget
  | AgentTurnTarget
  | ContentSelectionTarget

/** The target one location hands its rows. */
export type TargetAt<L extends ContextMenuLocation> = Extract<ContextMenuTarget, { location: L }>

export type ContextMenuContribution<L extends ContextMenuLocation = ContextMenuLocation> = {
  id: string
  location: L
  /** Required for a plugin rail row; identifies the one owned icon it can target. */
  surface?: string
  label: string
  /** A Lucide name or a `brand:` mark, resolved by Icon. */
  icon?: string
  order: number
  tone?: 'neutral' | 'danger'
  /** Core passes a function; a plugin's declared map is compiled into one by the chrome pass. */
  when?: (target: TargetAt<L>) => boolean
  run: (target: TargetAt<L>) => void
}

export const contextMenuRegistry = new Registry<ContextMenuContribution>('context-menu')

const ownsRailTarget = (item: ContextMenuContribution, target: ContextMenuTarget): boolean => {
  if (target.location !== 'rail.source' && target.location !== 'rail.pane') return true
  const owner = contextMenuRegistry.ownerOf(item.id)
  if (!owner) return true // Host actions are registered without a plugin owner.
  if (item.surface !== target.id) return false
  return (
    (target.location === 'rail.source' ? sourceRegistry.ownerOf(target.id) : paneRegistry.ownerOf(target.id)) === owner
  )
}

/** The rows this location offers for this target, in declared order. Ties break on id so two
 *  contributions at the same order are stable rather than dependent on registration sequence, the
 *  same rule the slot hosts apply. */
export const contextMenuItems = <L extends ContextMenuLocation>(
  location: L,
  target: TargetAt<L>,
): ContextMenuContribution[] =>
  contextMenuRegistry
    .entries()
    .filter((item) => item.location === location && ownsRailTarget(item, target) && (item.when?.(target) ?? true))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

/** Register several at once and dispose them together, the shape `registerCommands` already has and
 *  the shape a component's `onCleanup` wants. */
export function registerContextMenuItems<L extends ContextMenuLocation>(
  items: ContextMenuContribution<L>[],
): { dispose(): void } {
  // The one cast in this module. A contribution is written against the target its own location
  // hands out, and the registry holds every location's, so what goes in is narrower than what comes
  // back. `contextMenuItems` only ever hands a row the target for the location it was filtered on,
  // which is the invariant the cast stands on.
  const disposables = items.map((item) => contextMenuRegistry.register(item as unknown as ContextMenuContribution))
  return { dispose: () => disposables.forEach((entry) => entry.dispose()) }
}

/** What the menu log calls a target: a file by its path, a message or turn by its own id, and a
 *  selection by its owner and kind, never its text. */
const targetName = (target: ContextMenuTarget): string =>
  target.location === 'content.selection'
    ? `${target.ownerId} ${target.contentKind}`
    : 'path' in target
      ? target.path
      : 'itemId' in target
        ? target.itemId
        : 'id' in target
          ? target.id
          : target.turnId

/** Run one row's action. A contribution's `run` is other people's code (core's own closures today, a
 *  plugin's verb dispatch tomorrow), and a menu row that throws must not take the shell's click
 *  handler with it. The row has already closed by the time this runs, so there is nowhere to show the
 *  failure but the console. */
export function runContextMenuItem<L extends ContextMenuLocation>(
  item: ContextMenuContribution<L>,
  target: TargetAt<L>,
): void {
  try {
    // A menu can outlive a plugin registration for a frame. Never run a captured replacement.
    if ((contextMenuRegistry.get(item.id) as unknown) !== item) return
    if (!ownsRailTarget(item as unknown as ContextMenuContribution, target)) return
    item.run(target)
  } catch (error) {
    log.warn(`'${item.id}' failed on ${target.location} '${targetName(target)}'`, error, { 'menu.item': item.id })
  }
}

/** A declared `when` compiled into a predicate. Exported because it is the half of a plugin
 *  contribution that has no other observable effect: the chrome pass hands the result to the registry,
 *  where a test can only see whether a row appeared. */
export const compileWhen =
  (when: Readonly<Record<string, string | boolean>> | undefined): ((target: ContextMenuTarget) => boolean) =>
  (target) =>
    matchesWhen(when, target as unknown as Record<string, unknown>)
