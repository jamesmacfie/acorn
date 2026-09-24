import { initClientPlugins } from '@acorn/client-core/host/registries/extensionPoints'
import { disabledNodePlugins, refreshNodePlugins } from '@acorn/client-core/infra/node'
import { pluginFailureAttention } from '@acorn/client-core/infra/node'
import { attentionRegistry } from '@acorn/client-core/host/registries/rail'
import { noticeKindContributions } from '@acorn/client-core/features/notifications'
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
import { clientPlugins } from './plugins'
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
// ...and where clicking one of its rows lands. The settings modal belongs to the shell, so the shell
// answers for this target kind; `resourceId` is the settings page id, so any row from anywhere can
// deep-link to a page without core growing a second vocabulary for it.
registerNoticeTargetHandler('settings', (_taskId, target) => {
  clientEvents.emit('presentation:open-settings', { tab: target.resourceId })
})
activateScopedStateEviction()
// The first activation runs with nothing disabled, and that is not a placeholder: the list belongs to
// a node, and at module-evaluation time no node has answered yet. `applyNodePlugins` below is called
// once before the first render and again on every node switch.
//
// Registering everything first, rather than blocking here, trades a different failure for a better
// one. A plugin that never registers cannot be brought back by anything short of a second activation,
// so the worst case of registering everything first is a contribution that disappears a moment later;
// the worst case of waiting is a shell that will not paint because a node is slow to answer.
const activated = initClientPlugins(clientPlugins)
if (activated.skipped.length) log.info(`plugins disabled: ${activated.skipped.join(', ')}`)

// Re-run the host with whatever the active node reports. This is the client-side disable: the host
// takes each plugin's previous contributions back before re-registering, so one call replaces a
// predicate threaded through nine registry accessors (node/nodePlugins.ts explains the trade at
// length).
//
// `applied` makes it idempotent per node, so App.tsx can call it from a plain mount effect (which
// fires for the first node too, right after index.tsx already did) without disposing and
// re-registering every contribution a second time mid-paint.
let applied: string | null = null

export async function applyNodePlugins(nodeId?: string): Promise<void> {
  const target = nodeId ?? null
  if (target !== null && applied === target) return
  const state = await refreshNodePlugins(nodeId)
  // Only mark it applied once the node has actually answered. A read failure leaves `applied` alone so the
  // next mount retries, rather than pinning the full contribution set for the session.
  if (state) applied = target
  const disabled = disabledNodePlugins()
  const result = initClientPlugins(clientPlugins, { disabled })
  if (result.skipped.length) log.info(`plugins disabled by this node: ${result.skipped.join(', ')}`)
}
