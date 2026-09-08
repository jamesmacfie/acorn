// "Start workflow…" on a Rollbar error, a Linear issue or a GitHub pull request: what the row menu
// asks for, and what the item fills in (docs/workflows.md § Starting a run).
//
// A `.ts` module of its own, beside ./editor/startRequest.ts and for its reason: the prefill rule is
// the half worth testing and a Solid component on the path makes it unloadable in a node-environment
// test (docs/plugin-authoring.md § Testing). The box it opens is ./StartFromItemHost.tsx.
import { createSignal } from 'solid-js'
import type { ItemRowTarget } from '@acorn/plugin-api/client'

/**
 * What an item fills in, keyed by input name.
 *
 * By name rather than by declaration order or by a mapping each integration writes, so a definition
 * that says `inputs = [{ name = "issue" }]` works from every tracker and a new one gets the rule for
 * free. Two groups: `issue`, `item` and `context` get the title and the body one blank line apart,
 * and `link` or `url` gets somewhere to read it. Every other name is left for the person, because
 * guessing at `focus` or `depth` from an error title puts words in a prompt nobody chose.
 *
 * The names are exact. A definition that spells one `Issue` fills it in itself, which is the same
 * bargain `${inputs.<name>}` already strikes.
 */
export function prefillFromItem(item: { title?: string; body?: string; link?: string }): Record<string, string> {
  const both = [item.title, item.body].filter((part) => part?.trim()).join('\n\n')
  return {
    ...(both ? { issue: both, item: both, context: both } : {}),
    ...(item.link ? { link: item.link, url: item.link } : {}),
  }
}

/** The row menu's ask, held until the overlay draws it. One at a time: a second right-click replaces
 *  the first rather than stacking two modals. */
const [pending, setPending] = createSignal<ItemRowTarget | null>(null)

export const startFromItemTarget = pending

export const closeStartFromItem = (): void => {
  setPending(null)
}

export const openStartFromItem = (target: ItemRowTarget): void => {
  setPending(target)
}
