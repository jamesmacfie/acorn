import { initClientPlugins } from '@acorn/client-core/host/registries/extensionPoints'
import { disabledNodePlugins, refreshNodePlugins } from '@acorn/client-core/infra/node'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { createSignal } from 'solid-js'
import { pluginFailureAttention, pluginWaitingAttention } from '@acorn/client-core/infra/node'
import { attentionRegistry } from '@acorn/client-core/host/registries/rail'
import { noticeKindContributions } from '@acorn/client-core/features/notifications'
import { connectionAttention } from '@acorn/client-core/features/settings'
import { registerNoticeTargetHandler } from '@acorn/client-core/features/notifications'
import { clientEvents } from '@acorn/client-core/host/registries/commands'
import { directPreferenceSlices } from '@acorn/client-core/infra/persistence'
import { persistedStateRegistry } from '@acorn/client-core/infra/persistence'
import { coreStateSlices } from '@acorn/client-core/infra/persistence'
import { noticeKindRegistry } from '@acorn/client-core/host/registries/rail'
import { clientScheduleRegistry } from '@acorn/client-core/host/registries/shell'
import { settingsRegistry } from '@acorn/client-core/host/registries/shell'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { uiSlotRegistry } from '@acorn/client-core/host/registries/extensionPoints/uiSlots.tsx'
import { taskStatusScheduleContribution } from '@acorn/client-core/features/tasks'
import { settingsPageContributions } from './pageContributions'
import { createPluginStartup } from './pluginStartup'
import { activateScopedStateEviction } from './scopedEviction'
import { shellSlotContributions } from './slotContributions'
import { coreSourceContributions } from './sourceContributions'
import { ensurePluginChannel } from '@acorn/client-core/host/plugins'
import { createLogger } from '@acorn/client-core/infra/telemetry'

const log = createLogger('client:boot')

// The one WS prefix core claims on every loaded plugin's behalf, since a loaded plugin cannot claim one
// itself (plugins/pluginChannel.ts). Claimed here with core's own three so the set is fixed at boot and
// the prefix test can pin it; the socket still opens on the first subscriber, not now.
ensurePluginChannel()

for (const kind of noticeKindContributions) noticeKindRegistry.register(kind)
for (const page of settingsPageContributions) settingsRegistry.register(page)
for (const contribution of shellSlotContributions) uiSlotRegistry.register(contribution)
// Core's home is the stable default; Fleet is hidden by its own `when` until a second node is paired.
for (const source of coreSourceContributions) sourceRegistry.register(source)
// Core's own persisted state: the shell slices (selection, layouts, drawer height, notices) plus the
// direct preference slices. Which features persist state is each plugin's own declaration now,
// through ctx.persistedStateSlices. The app no longer holds a list of four plugin slices it does not own.
for (const slice of [...coreStateSlices, ...directPreferenceSlices]) persistedStateRegistry.register(slice)
clientScheduleRegistry.register(taskStatusScheduleContribution)
// Core's own attention source: plugins this node installed but could not start. Registered here
// rather than by a plugin, because the plugin that failed is not running to report itself.
attentionRegistry.register(pluginFailureAttention)
// And what waits on the person there: a review, an approval, or a node restart. The same rows put the
// dot on Plugins in the settings rail.
attentionRegistry.register(pluginWaitingAttention)
// And a connection whose provider refused its credential, which puts the dot on Services or AI models.
attentionRegistry.register(connectionAttention)
// ...and where clicking one of its rows lands. The settings view belongs to the shell, so the shell
// answers for this target kind; `resourceId` is the settings page id, so any row from anywhere can
// deep-link to a page without core growing a second vocabulary for it.
registerNoticeTargetHandler('settings', (_taskId, target) => {
  clientEvents.emit('presentation:open-settings', { tab: target.resourceId })
})
activateScopedStateEviction()
// Core registration stays eager; the compiled roster and its implementation closure load after the
// shell paints. Restore waits for this signal so pane defaults cannot replace persisted layouts.
const [clientPluginsReady, setClientPluginsReady] = createSignal(false)
export { clientPluginsReady }

const startup = createPluginStartup({
  load: async () => (await import('./plugins')).clientPlugins,
  register: (plugins, disabled) => {
    const result = initClientPlugins(plugins, { disabled })
    if (result.skipped.length) log.info(`plugins disabled: ${result.skipped.join(', ')}`)
  },
  refresh: async (nodeId) => {
    const state = await refreshNodePlugins(nodeId)
    return state ? state.plugins.filter((plugin) => plugin.disabled).map((plugin) => plugin.name) : null
  },
  activeNode: activeNodeId,
  disabled: disabledNodePlugins,
  onReady: () => setClientPluginsReady(true),
})

export const startClientPlugins = async (): Promise<void> => { await startup.initialize() }

export async function applyNodePlugins(nodeId?: string): Promise<void> {
  const target = nodeId ?? activeNodeId()
  if (target) await startup.apply(target)
}
