import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import { fuzzyScore } from '../../../kit/lib/paletteModel'
import type { CommandExecutionContext, SearchCommand } from './commands'

// A search whose rows are already on this machine: fetch the list once when the frame opens, then
// filter it here as the reader types.
//
// This is what the two contributions still using `paletteRows` actually are. The terminal's run
// targets and the workflow definitions come from the open task's configuration in one read, and the
// old palette fetched them when it opened and filtered them with the same fuzzy scorer this uses.
// Written as a remote search they would spend a request per keystroke on data that never moved, so
// the two knobs the search contract exposes are turned off: nothing is debounced, because there is
// nothing to wait for, and there is no minimum query, because an empty one is the whole list.
//
// The compiled tier only. A loaded plugin's rows come over a route and are debounced and bounded
// (host/chrome/chromeCommands.ts), which is the difference between code in this bundle and a
// manifest.

/** What a local search fetches when its frame opens. */
export type LocalSearchLoad = (
  context: CommandExecutionContext,
  signal: AbortSignal,
) => Promise<readonly CommandSearchItem[]> | readonly CommandSearchItem[]

const matches = (query: string, item: CommandSearchItem): number | null => {
  const title = fuzzyScore(query, item.title)
  const subtitle = item.subtitle ? fuzzyScore(query, item.subtitle) : null
  if (title === null) return subtitle
  return subtitle === null ? title : Math.max(title, subtitle)
}

/**
 * The three search fields a load-once provider declares, ready to spread into a `search` command.
 *
 * ```ts
 * { id: 'terminal.targets', kind: 'search', title: 'Run a target', category: 'terminal', palette: true,
 *   ...localSearch((context, signal) => readTargets(context.taskId, signal)),
 *   select: (item) => launch(item.ref!) }
 * ```
 */
export function localSearch(load: LocalSearchLoad): Pick<SearchCommand, 'minQueryLength' | 'debounceMs' | 'query'> {
  // One cache per provider, keyed on the captured context, which is one object per open session: a
  // session that opens over a different task loads again, a frame re-entered inside one session does
  // not, and two local searches in the same session do not read each other's rows. Weak, so a closed
  // session's list is collectable without anybody being told to clear a cache.
  const loaded = new WeakMap<CommandExecutionContext, Promise<readonly CommandSearchItem[]>>()
  return {
    minQueryLength: 0,
    debounceMs: 0,
    query: async (text, context, signal) => {
      let rows = loaded.get(context)
      if (!rows) {
        rows = Promise.resolve(load(context, signal))
        loaded.set(context, rows)
      }
      let items: readonly CommandSearchItem[]
      try {
        items = await rows
      } catch (error) {
        // A failed load is not cached: the frame shows the failure, and pressing Enter on it asks
        // again rather than replaying the same rejection forever.
        loaded.delete(context)
        throw error
      }
      const query = text.trim()
      if (!query) return items
      // The provider's order survives a tie, which is what keeps a list somebody arranged from
      // reshuffling under a query that does not distinguish two of its rows.
      return items
        .map((item, at) => ({ item, at, score: matches(query, item) }))
        .filter((row): row is { item: CommandSearchItem; at: number; score: number } => row.score !== null)
        .sort((a, b) => b.score - a.score || a.at - b.at)
        .map((row) => row.item)
    },
  }
}
