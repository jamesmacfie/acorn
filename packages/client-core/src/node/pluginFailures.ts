import { corePluginsRoute, type NodePluginState } from '@acorn/protocol/api.ts'
import { readJson } from '../apiClient'
import type { AttentionSourceContribution } from '../registries/attention'

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
export const pluginFailureAttention: AttentionSourceContribution = {
  id: 'core.pluginFailures',
  // Above the plugins' own sources: a plugin that did not start is more urgent than anything a
  // plugin that did start has to say.
  order: 5,
  fetch: async (nodeId, signal) => {
    const state = await readJson<NodePluginState>(corePluginsRoute, { nodeId, signal })
    return state.plugins
      .filter((row) => row.state === 'failed')
      .map((row) => ({
        id: `core.pluginFailures:${row.name}`,
        title: `Plugin ${row.name} failed to start`,
        // No restart advice: the plugin threw during init, and restarting runs the same code again.
        detail: 'It is installed on this node but its start-up threw. Its routes and contributions are not registered.',
        // `warn`, not `danger`: the node itself is healthy and everything else is running.
        severity: 'warn' as const,
        // The host stamps this when it contains the failure, so the row reads "3 hours ago" rather
        // than resetting to "just now" on every poll.
        at: row.failedAt ?? 0,
      }))
  },
}
