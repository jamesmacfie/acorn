// The context-menu registry: what a right-click offers, contributed rather than written inline
// (docs/plugins.md § Context menus).
//
// This module holds no JSX import (docs/frontend.md § Registries and plugins): the host that draws
// these rows lives in `./contextMenuHost.tsx`, a `<For>` over `contextMenuItems()`.
import { matchesWhen, type ContextMenuLocation } from '@acorn/protocol/contextMenus.ts'
import { Registry } from './registry'

export type { ContextMenuLocation }

/**
/**
 * What is under the cursor, as the host describes it. One member for now, and the shape is flat
 * scalars on purpose: a declared `when` is a map of literals compared against these fields, so a
 * nested value would be a fact no manifest could name.
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

export type ContextMenuTarget = TaskRowTarget

export type ContextMenuContribution = {
  id: string
  location: ContextMenuLocation
  label: string
  /** A Lucide name or a `brand:` mark, resolved by Icon. */
  icon?: string
  order: number
  tone?: 'neutral' | 'danger'
  /** Core passes a function; a plugin's declared map is compiled into one by the chrome pass. */
  when?: (target: ContextMenuTarget) => boolean
  run: (target: ContextMenuTarget) => void
}

export const contextMenuRegistry = new Registry<ContextMenuContribution>('context-menu')

/** The rows this location offers for this target, in declared order. Ties break on id so two
 *  contributions at the same order are stable rather than dependent on registration sequence, the
 *  same rule the slot hosts apply. */
export const contextMenuItems = (
  location: ContextMenuLocation,
  target: ContextMenuTarget,
): ContextMenuContribution[] =>
  contextMenuRegistry.entries()
    .filter((item) => item.location === location && (item.when?.(target) ?? true))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

/** Register several at once and dispose them together, the shape `registerCommands` already has and
 *  the shape a component's `onCleanup` wants. */
export function registerContextMenuItems(items: ContextMenuContribution[]): { dispose(): void } {
  const disposables = items.map((item) => contextMenuRegistry.register(item))
  return { dispose: () => disposables.forEach((entry) => entry.dispose()) }
}

/** Run one row's action. A contribution's `run` is other people's code (core's own closures today, a
 *  plugin's verb dispatch tomorrow), and a menu row that throws must not take the shell's click
 *  handler with it. The row has already closed by the time this runs, so there is nowhere to show the
 *  failure but the console. */
export function runContextMenuItem(item: ContextMenuContribution, target: ContextMenuTarget): void {
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
