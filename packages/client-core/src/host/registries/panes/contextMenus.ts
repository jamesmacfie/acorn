// The context-menu registry: what a right-click offers, contributed rather than written inline
// (docs/plugins.md § Context menus).
//
// This module holds no JSX import (docs/frontend.md § Registries and plugins): the host that draws
// these rows lives in `./contextMenuHost.tsx`, a `<For>` over `contextMenuItems()`.
import { matchesWhen, type ContextMenuLocation } from '@acorn/protocol/contextMenus.ts'
import { Registry } from '../../../kit/lib/registry'

export type { ContextMenuLocation }

/**
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
 * workflow prefill reads (docs/workflows.md § Starting a run).
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

export type ContextMenuTarget = TaskRowTarget | ItemRowTarget

/** The target one location hands its rows. */
export type TargetAt<L extends ContextMenuLocation> = Extract<ContextMenuTarget, { location: L }>

export type ContextMenuContribution<L extends ContextMenuLocation = ContextMenuLocation> = {
  id: string
  location: L
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

/** The rows this location offers for this target, in declared order. Ties break on id so two
 *  contributions at the same order are stable rather than dependent on registration sequence, the
 *  same rule the slot hosts apply. */
export const contextMenuItems = <L extends ContextMenuLocation>(
  location: L,
  target: TargetAt<L>,
): ContextMenuContribution[] =>
  contextMenuRegistry.entries()
    .filter((item) => item.location === location && (item.when?.(target) ?? true))
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

/** Run one row's action. A contribution's `run` is other people's code (core's own closures today, a
 *  plugin's verb dispatch tomorrow), and a menu row that throws must not take the shell's click
 *  handler with it. The row has already closed by the time this runs, so there is nowhere to show the
 *  failure but the console. */
export function runContextMenuItem<L extends ContextMenuLocation>(
  item: ContextMenuContribution<L>,
  target: TargetAt<L>,
): void {
  try {
    item.run(target)
  } catch (error) {
    console.warn(`[context-menu] '${item.id}' failed on ${target.location} '${target.id}':`, error)
  }
}

/** A declared `when` compiled into a predicate. Exported because it is the half of a plugin
 *  contribution that has no other observable effect: the chrome pass hands the result to the registry,
 *  where a test can only see whether a row appeared. */
export const compileWhen = (
  when: Readonly<Record<string, string | boolean>> | undefined,
): ((target: ContextMenuTarget) => boolean) =>
  (target) => matchesWhen(when, target as unknown as Record<string, unknown>)
