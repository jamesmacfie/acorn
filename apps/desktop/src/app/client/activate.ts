// Renderer activation: register CORE's contributions, then run every client plugin's init.
//
// This file used to name all fourteen plugins' contribution modules by hand and push them into fifteen
// registries — 91 lines in which adding a pane meant editing the app, and turning a plugin off meant
// deleting lines. Both halves of that are gone: the plugin list is plugins.ts, and each plugin says what
// it contributes in its own client/index.ts. What is left below is what genuinely belongs to the
// composition root — core's own contributions, which no plugin owns.
//
// Ordering: core first, then plugins. That is not load-bearing (core contributes no rail source, and
// every other registry sorts), but it keeps the shell's own overlays and pollers registered before any
// plugin can observe the registries.
import { initClientPlugins } from '@acorn/client-core/registries/plugin.ts'
import { disabledNodePlugins, refreshNodePlugins } from '@acorn/client-core/node/nodePlugins.ts'
import { noticeKindContributions } from '@acorn/client-core/notifications/kindContributions.ts'
import { directPreferenceSlices } from '@acorn/client-core/persistence/preferenceSlices.ts'
import { persistedStateRegistry } from '@acorn/client-core/persistence/persistedState.ts'
import { coreStateSlices } from '@acorn/client-core/persistence/stateSlices.ts'
import { noticeKindRegistry } from '@acorn/client-core/registries/notices.ts'
import { pollerRegistry } from '@acorn/client-core/registries/pollers.ts'
import { settingsRegistry } from '@acorn/client-core/registries/settings.ts'
import { uiSlotRegistry } from '@acorn/client-core/registries/uiSlots.tsx'
import { taskStatusPollerContribution } from '@acorn/client-core/tasks/taskStatus.ts'
import { settingsPageContributions } from './pageContributions'
import { clientPlugins } from './plugins'
import { activateScopedStateEviction } from './scopedEviction'
import { shellSlotContributions } from './slotContributions'

for (const kind of noticeKindContributions) noticeKindRegistry.register(kind)
for (const page of settingsPageContributions) settingsRegistry.register(page)
for (const contribution of shellSlotContributions) uiSlotRegistry.register(contribution)
// Core's own persisted state: the shell slices (selection, layouts, drawer height, notices) plus the
// direct preference slices. Which FEATURES persist state is each plugin's own declaration now, through
// ctx.persistedState — the app no longer holds a list of four plugin slices it does not own.
for (const slice of [...coreStateSlices, ...directPreferenceSlices]) persistedStateRegistry.register(slice)
pollerRegistry.register(taskStatusPollerContribution)
activateScopedStateEviction()

// The first activation runs with nothing disabled, and that is not a placeholder any more: the list
// belongs to a NODE, and at module-evaluation time no node has answered yet. `applyNodePlugins` below is
// called once before the first render and again on every node switch.
//
// Empty-first rather than blocking here is deliberate. A plugin that never registers cannot be brought
// back by anything short of a second activation, so the worst case of registering everything first is a
// contribution that disappears a moment later; the worst case of waiting is a shell that will not paint
// because a node is slow to answer.
const activated = initClientPlugins(clientPlugins)
if (activated.skipped.length) console.log(`[client:boot] plugins disabled: ${activated.skipped.join(', ')}`)

// Re-run the host with whatever the active node reports. This IS the client-side disable: the host takes
// each plugin's previous contributions back before re-registering, so one call replaces a predicate
// threaded through nine registry accessors (node/nodePlugins.ts explains the trade at length).
export async function applyNodePlugins(nodeId?: string): Promise<void> {
  await refreshNodePlugins(nodeId)
  const disabled = disabledNodePlugins()
  const result = initClientPlugins(clientPlugins, { disabled })
  if (result.skipped.length) console.log(`[client] plugins disabled by this node: ${result.skipped.join(', ')}`)
}
