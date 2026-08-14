import { corePluginsRoute, type NodePluginRow, type NodePluginState } from '@acorn/protocol/api.ts'
import { readJson } from '../apiClient'
import { surfaceFailures } from '../plugins/surfaceFailures'
import type { AttentionItem, AttentionSourceContribution } from '../registries/attention'

// "Plugin X failed to start", in the notification bell, so the owner learns about it without opening
// Settings → Plugins (docs/plugins.md).
//
// Core-owned rather than plugin-contributed, and registered from the client composition root beside
// the other core contributions — the plugin that failed is by definition not running to speak for
// itself, and the state belongs to the node rather than to any one plugin.
//
// It is an ATTENTION item and not a notice for the reason registries/attention.ts gives: this is a
// state, not an event. The plugin stays broken across refetches until the owner disables it or fixes
// it, so dismissing it and having it come back is the correct behaviour.
// 'load' means the package never ran at all — its manifest did not parse, its bundle did not import, its
// apiVersion is not this node's. Saying "failed to start" for that is the small lie the old wording told.
//
// A row that carries a reason while its state is NOT 'failed' is the third case: a package on disk claimed
// a name something else already answers to — a dogfooded copy of a built-in, or a second directory
// claiming a won id. What is running is fine, so this is not a failure of the plugin; it is a failure of
// the copy the owner installed, and saying "failed to load" would send them looking at the wrong thing.
const titleFor = (row: NodePluginRow): string => {
  if (row.state !== 'failed') return `Plugin ${row.name}: the copy installed on this node did not load`
  return `Plugin ${row.name} failed to ${row.stage === 'load' ? 'load' : 'start'}`
}

// The generic sentence, used only when the node is too old to send a reason. Everything a newer node sends
// is more specific than this by construction.
const FALLBACK_DETAIL = 'It is installed on this node but its start-up threw. Its routes and contributions are not registered.'

export const pluginFailureAttention: AttentionSourceContribution = {
  id: 'core.pluginFailures',
  // Above the plugins' own sources: a plugin that did not start is more urgent than anything a
  // plugin that did start has to say.
  order: 5,
  fetch: async (nodeId, signal) => {
    const state = await readJson<NodePluginState>(corePluginsRoute, { nodeId, signal })
    const items: AttentionItem[] = state.plugins
      // A reason with no failure is the shadowed-name case titleFor describes — the node reports it on a
      // row whose own state is honestly 'active', so filtering on state alone dropped it.
      .filter((row) => row.state === 'failed' || row.reason !== undefined)
      .map((row) => ({
        id: `core.pluginFailures:${row.name}`,
        title: titleFor(row),
        // What actually broke, in the words of whatever broke it. Interpolated as TEXT — this is a loaded
        // plugin's own thrown message crossing into the owner's UI, it is never markup, and the node has
        // already capped its length (node-core/server/plugin/pluginState.ts).
        //
        // No restart advice either way: a plugin that threw during init runs the same code again, and a
        // bundle that will not import will not import next boot either.
        detail: row.reason ?? FALLBACK_DETAIL,
        // `warn`, not `danger`: the node itself is healthy and everything else is running.
        severity: 'warn' as const,
        // The node stamps this — `contain()` for an init failure, the loader's own pass for a load
        // failure — so the row reads "3 hours ago" rather than resetting to "just now" on every poll.
        //
        // `Date.now()` and not 0 when it is genuinely absent, which now only happens against a node too
        // old to send it. `at` is required and feeds the relative time AND the newest-first sort, so 0
        // rendered every load failure as a 56-year-old event that also sorted last in its band. The cost
        // of this fallback is that such a row does reset to "just now" each poll; that is the lesser lie,
        // and it disappears once the node is updated.
        at: row.failedAt ?? Date.now(),
      }))
    // Surfaces THIS DEVICE could not register, from the same plugins. Scoped by the roster we just read
    // rather than by a second source of truth: the registration pass merges every node's roster, so a
    // surface failure belongs on the card of whichever node actually offers that plugin.
    const onThisNode = new Set(state.plugins.map((row) => row.name))
    for (const failure of surfaceFailures()) {
      if (!onThisNode.has(failure.pluginId)) continue
      items.push({
        id: `core.pluginFailures:surface:${failure.pluginId}:${failure.surface}`,
        title: `Plugin ${failure.pluginId} could not contribute '${failure.surface}'`,
        detail: failure.reason,
        severity: 'warn' as const,
        at: failure.at,
      })
    }
    return items
  },
}
