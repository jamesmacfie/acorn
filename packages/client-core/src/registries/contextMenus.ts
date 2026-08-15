// The context-menu registry: what a right-click offers, contributed rather than written inline.
//
// JSX-free on purpose, exactly as ./slots.ts is: the host that draws these lives in
// ./contextMenuHost.tsx, and this repo's vitest runs in a bare Node environment with no Solid
// transform, so a module that reaches a JSX file cannot be imported by a test at all. Everything worth
// pinning — the location vocabulary, the `when` evaluation, the ordering, the owner binding — is
// therefore here, and the `.tsx` is a `<For>` over `contextMenuItems()`.
//
// CORE IS THE FIRST CONSUMER. The tab rail's Pin/Unpin/Rename/Archive rows are registrations on this
// registry (tabs/TabRail.tsx), and they were inline JSX before. That is deliberate: a contribution
// contract whose only consumer is a third party is a contract nobody has used, and the two-item
// pin/unpin pair is what proves `when` is real rather than decorative.
//
// TWO DOORS, ONE LIST. The rail draws these items from the button-triggered menu it already had AND
// from a right-click on the same row. The registry is what makes that one list instead of two that
// drift, and it is why right-click is not a keyboard-only-users-lose feature: everything reachable by
// right-click is reachable from the button, and the browser's own Shift+F10 / menu key fires
// `contextmenu` on the focused row anyway.
import { matchesWhen, type ContextMenuLocation } from '@acorn/protocol/contextMenus.ts'
import { Registry } from './registry'

export type { ContextMenuLocation }

/**
 * What is under the cursor, as the HOST describes it. One member for now, and the shape is flat
 * scalars on purpose: a declared `when` is a map of literals compared against these fields, so a
 * nested value would be a fact no manifest could name.
 *
 * The fields a `when` may name are the ones in `CONTEXT_MENU_FACTS`, which is a strict subset —
 * `id` and `title` are the item's payload, not a predicate.
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
 *  contributions at the same order are stable rather than dependent on registration sequence — the
 *  same rule the slot hosts apply. */
export const contextMenuItems = (
  location: ContextMenuLocation,
  target: ContextMenuTarget,
): ContextMenuContribution[] =>
  contextMenuRegistry.entries()
    .filter((item) => item.location === location && (item.when?.(target) ?? true))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

/** Register several at once and dispose them together — the shape `registerCommands` already has, and
 *  the shape a component's `onCleanup` wants. */
export function registerContextMenuItems(items: ContextMenuContribution[]): { dispose(): void } {
  const disposables = items.map((item) => contextMenuRegistry.register(item))
  return { dispose: () => disposables.forEach((entry) => entry.dispose()) }
}

/** Run one row's action. A contribution's `run` is other people's code — core's own closures today, a
 *  plugin's verb dispatch tomorrow — and a menu row that throws must not take the shell's click
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
