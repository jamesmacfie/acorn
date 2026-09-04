import { MAX_COMMAND_SEARCH_ITEMS, type CommandSearchItem } from '@acorn/protocol/commands.ts'
import type { RollbarItemSummary } from '../shared/api'
import { rollbarRailItemId } from '../shared/rail'

// Ranking the palette's Rollbar rows, as a pure function over the list the rail already has.
//
// Separate from the route because this is the only part worth reading twice: the route is scope and
// failure handling, and this is what a typed word means. It runs on the node, so the shell's
// `fuzzyScore` is not available to it (that lives in client-core's kit); the ordering below is the
// same idea spelled for a short, stable list — an exact identifier beats a title, a title beats the
// facts around it, and equal matches keep the order they arrived in, which is Rollbar's own
// most-recent-first.
//
// Four fields, and they are the four a person types: the message, the counter they were handed in a
// stack trace, the level they are triaging by, and the framework when one account carries several
// services (docs/integrations.md § From the command palette).

// The bounds @acorn/protocol/commands.ts holds a row to. Trimmed here rather than left to the host,
// because the host drops an oversized row outright and a long error message is ordinary in Rollbar.
const TITLE = 300
const SUBTITLE = 300
const BADGE = 80

const contains = (haystack: string | undefined, needle: string): boolean =>
  !!haystack && haystack.toLowerCase().includes(needle)

/**
 * How well one item answers `query`, or `null` for a row that does not answer it at all.
 *
 * Higher is better. The tiers are deliberately coarse: within a tier the incoming order decides, and
 * the incoming order is the one the rail already sorts by, so a reader who types nothing useful still
 * gets the most recent errors rather than an arbitrary shuffle.
 */
export function rollbarSearchScore(item: RollbarItemSummary, query: string): number | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  // `#142` is how Rollbar writes a counter everywhere it shows one, so it is how somebody pastes it.
  const counter = needle.startsWith('#') ? needle.slice(1) : needle
  const identifier = item.identifier.toLowerCase()
  if (counter && identifier === counter) return 4
  const title = item.title.toLowerCase()
  if (title.startsWith(needle)) return 3
  if (title.includes(needle)) return 2
  if (identifier.includes(counter) || contains(item.level, needle) || contains(item.framework, needle)) return 1
  return null
}

/** One row, as the palette draws it: display facts and the identity the project surface is addressed
 *  by. The id is the rail's own `<connection>:<identifier>`, because a Rollbar counter is only unique
 *  inside its connection and that is the id `navigate` puts in the URL (../shared/rail.ts). */
export const rollbarSearchItem = (item: RollbarItemSummary): CommandSearchItem => ({
  id: rollbarRailItemId(item),
  title: item.title.slice(0, TITLE) || `#${item.identifier}`,
  subtitle: [`#${item.identifier}`, item.level, item.environment, item.integrationLabel]
    .filter(Boolean).join(' · ').slice(0, SUBTITLE),
  badge: `${item.totalOccurrences} occurrence${item.totalOccurrences === 1 ? '' : 's'}`.slice(0, BADGE),
  ref: item.identifier,
})

/** The matching rows, best first, capped at what the host will render anyway. */
export function rollbarSearchItems(items: readonly RollbarItemSummary[], query: string): CommandSearchItem[] {
  return items
    .map((item, at) => ({ item, at, score: rollbarSearchScore(item, query) }))
    .filter((row): row is { item: RollbarItemSummary; at: number; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, MAX_COMMAND_SEARCH_ITEMS)
    .map((row) => rollbarSearchItem(row.item))
}
