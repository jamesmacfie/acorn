import { corePluginsRoute, type NodePluginRow, type NodePluginState } from '@acorn/protocol/api.ts'
import { readJson } from './apiClient'
import { surfaceFailures } from '../../host/plugins/surfaceFailures'
import type { AttentionItem, AttentionSourceContribution } from '../../host/registries/rail/attention'
import { distribution } from '../../host/plugins/distribution'
import { nodePluginStatus } from '../../host/plugins/pluginStatus'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { nodes } from './fleet'

// "Plugin X failed to start", in the notification bell, so the owner learns about it without opening
// Settings → Plugins (docs/plugins.md § Activation).
//
// Core-owned rather than plugin-contributed, because the plugin that failed is not running to speak
// for itself and the state belongs to the node.
//
// An attention item rather than a notice (registries/attention.ts), because this is a state. The
// plugin stays broken across refetches until the owner disables it or fixes it, so a dismissed row
// coming back is correct.
//
// Three cases the wording has to keep apart. 'load' means the package never ran: its manifest did not
// parse, its bundle did not import, or its apiVersion is not this node's. 'failed' means it started
// and threw. A reason on a row whose state is not 'failed' means the copy on disk claimed a name
// something else answers to, so what is running is fine and the installed copy is not.
//
// These rows use the plugin's name. The two waiting rows below keep the id, because they lead to a
// trust decision and a loaded plugin chooses its own name.
const titleFor = (row: NodePluginRow): string => {
  if (row.state !== 'failed') return `Plugin ${pluginLabel(row)}: the copy installed on this node did not load`
  return `Plugin ${pluginLabel(row)} failed to ${row.stage === 'load' ? 'load' : 'start'}`
}

// Every row here sends the reader to Settings > Plugins, which is the one place a failure can be
// acted on: disable the plugin, or read the rest of what the node knows about it. The handler for
// this kind is registered by the shell (apps/desktop/src/client/activate.ts), because opening the
// settings view is the shell's business and not this file's.
const SETTINGS_TARGET = { kind: 'settings', resourceId: 'plugins' } as const

// The generic sentence, used only when the node sends no reason.
const FALLBACK_DETAIL = 'It is installed on this node but its start-up threw. Its routes and contributions are not registered.'

export const pluginFailureAttention: AttentionSourceContribution = {
  id: 'core.pluginFailures',
  // Above the plugins' own sources, because a plugin that did not start outranks one that did.
  order: 5,
  fetch: async (nodeId, signal) => {
    const state = await readJson<NodePluginState>(corePluginsRoute, { nodeId, signal })
    const items: AttentionItem[] = state.plugins
      // A reason with no failure is the shadowed-name case titleFor describes. The node reports it on
      // a row whose state is 'active', so filtering on state alone drops it.
      .filter((row) => row.state === 'failed' || row.reason !== undefined)
      .map((row) => ({
        id: `core.pluginFailures:${row.name}`,
        title: titleFor(row),
        // A loaded plugin's own thrown message crossing into the owner's UI. Interpolated as text,
        // never markup, and the node caps its length (node-core/server/pluginHost/state.ts).
        //
        // No restart advice, because a plugin that threw during init runs the same code again.
        detail: row.reason ?? FALLBACK_DETAIL,
        // `warn`, not `danger`: the node itself is healthy and everything else is running.
        severity: 'warn' as const,
        // The node stamps this, so the row reads "3 hours ago" rather than resetting to "just now" on
        // every poll.
        //
        // `Date.now()` rather than 0 when it is absent. `at` feeds the relative time and the
        // newest-first sort, so 0 renders a load failure as a 56-year-old event that sorts last. The
        // cost is that such a row does reset to "just now" each poll.
        at: row.failedAt ?? Date.now(),
        target: SETTINGS_TARGET,
      }))
    // Surfaces this device could not register, from the same plugins. Scoped by the roster just read,
    // because the registration pass merges every node's roster and a surface failure belongs on the
    // card of the node that offers that plugin.
    const onThisNode = new Set(state.plugins.map((row) => row.name))
    for (const failure of surfaceFailures()) {
      if (!onThisNode.has(failure.pluginId)) continue
      items.push({
        id: `core.pluginFailures:surface:${failure.pluginId}:${failure.surface}`,
        title: `Plugin ${failure.pluginId} could not contribute '${failure.surface}'`,
        detail: failure.reason,
        severity: 'warn' as const,
        at: failure.at,
        target: SETTINGS_TARGET,
      })
    }
    return items
  },
}

// The other half of what waits on the person under Settings > Plugins: a package an agent asked for that
// is held for review, a bundle this device has not approved yet, and a node still running the plugins it
// started with. Rows rather than only the settings rail's dot, because each is a decision nobody else can
// make, and the dot is drawn from these rows (features/settings/SettingsView.tsx § waiting).
//
// A separate source from the failures above, because these are not failures: the node is healthy, and
// each clears the moment the person answers.
export const pluginWaitingAttention: AttentionSourceContribution = {
  id: 'core.pluginsWaiting',
  order: 6,
  fetch: async (nodeId, signal) => {
    const state = await readJson<NodePluginState>(corePluginsRoute, { nodeId, signal })
    const label = nodes().find((node) => node.nodeId === nodeId)?.label ?? 'This node'
    const items: AttentionItem[] = []
    for (const row of state.plugins) {
      if (row.pendingReview && !('corrupt' in row.pendingReview)) {
        items.push({
          id: `core.pluginsWaiting:review:${row.name}`,
          title: `Plugin ${row.name} is waiting for your review`,
          detail: 'An agent asked to install it. Its node code cannot start until you approve the package.',
          severity: 'warn',
          at: row.pendingReview.stagedAt,
          target: SETTINGS_TARGET,
        })
        continue
      }
      if (nodePluginStatus(distribution(), nodeId, row).line !== 'waiting') continue
      items.push({
        id: `core.pluginsWaiting:trust:${row.name}`,
        title: `Plugin ${row.name} is waiting for approval on this device`,
        detail: 'Nothing it draws appears here until you approve its bundle.',
        severity: 'warn',
        at: row.installed?.installedAt ?? Date.now(),
        target: SETTINGS_TARGET,
      })
    }
    if (state.restartRequired) {
      items.push({
        id: 'core.pluginsWaiting:restart',
        title: `${label} needs a restart`,
        detail: 'It is still running the plugins it started with. Restart it to apply the change.',
        severity: 'warn',
        at: Date.now(),
        target: SETTINGS_TARGET,
      })
    }
    return items
  },
}
