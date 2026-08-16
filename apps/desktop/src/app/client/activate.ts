import { initClientPlugins } from '@acorn/client-core/registries/plugin.ts'
import { disabledNodePlugins, refreshNodePlugins } from '@acorn/client-core/node/nodePlugins.ts'
import { pluginFailureAttention } from '@acorn/client-core/node/pluginFailures.ts'
import { attentionRegistry } from '@acorn/client-core/registries/attention.ts'
import { noticeKindContributions } from '@acorn/client-core/notifications/kindContributions.ts'
import { directPreferenceSlices } from '@acorn/client-core/persistence/preferenceSlices.ts'
import { purgeRetiredLocalStorage } from '@acorn/client-core/persistence/legacyStorage.ts'
import { persistedStateRegistry } from '@acorn/client-core/persistence/persistedState.ts'
import { coreStateSlices } from '@acorn/client-core/persistence/stateSlices.ts'
import { dashboardPaneContribution } from '@acorn/client-core/dashboards/DashboardPane.tsx'
import { noticeKindRegistry } from '@acorn/client-core/registries/notices.ts'
import { paneRegistry } from '@acorn/client-core/registries/panes.ts'
import { pollerRegistry } from '@acorn/client-core/registries/pollers.ts'
import { settingsRegistry } from '@acorn/client-core/registries/settings.ts'
import { sourceRegistry } from '@acorn/client-core/registries/sources.ts'
import { uiSlotRegistry } from '@acorn/client-core/registries/uiSlots.tsx'
import { taskStatusPollerContribution } from '@acorn/client-core/tasks/taskStatus.ts'
import { settingsPageContributions } from './pageContributions'
import { clientPlugins } from './plugins'
import { activateScopedStateEviction } from './scopedEviction'
import { shellSlotContributions } from './slotContributions'
import { coreSourceContributions } from './sourceContributions'

for (const kind of noticeKindContributions) noticeKindRegistry.register(kind)
for (const page of settingsPageContributions) settingsRegistry.register(page)
for (const contribution of shellSlotContributions) uiSlotRegistry.register(contribution)
// Core's home is the stable default; Fleet is hidden by its own `when` until a second node is paired.
for (const source of coreSourceContributions) sourceRegistry.register(source)
// Core's own persisted state: the shell slices (selection, layouts, drawer height, notices) plus the
// direct preference slices. Which FEATURES persist state is each plugin's own declaration now, through
// ctx.persistedState — the app no longer holds a list of four plugin slices it does not own.
for (const slice of [...coreStateSlices, ...directPreferenceSlices]) persistedStateRegistry.register(slice)
pollerRegistry.register(taskStatusPollerContribution)
// Core's own pane: a dashboard placement beside a task. Registered here rather than by a plugin
// because the composition layer is host-owned — a plugin that shipped it would own a surface whose
// contents belong to the user (docs/future/dashboards/refused.md § No per-plugin "dashboard"
// contribution kind).
paneRegistry.register(dashboardPaneContribution)
// Core's own attention source: plugins this node installed but could not start. Registered here
// rather than by a plugin, because the plugin that failed is not running to report itself.
attentionRegistry.register(pluginFailureAttention)
activateScopedStateEviction()
// Bytes an older release left in localStorage, some of them credential-bearing. Before anything renders,
// and in the SHELL rather than in the plugin that wrote them — a loaded plugin's frame has its own
// storage area and could not reach these (persistence/legacyStorage.ts).
const swept = purgeRetiredLocalStorage()
if (swept.length) console.log(`[client:boot] removed ${swept.length} retired local key(s)`)

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
//
// `applied` makes it idempotent per node, so App.tsx can call it from a plain mount effect (which fires for
// the first node too, right after index.tsx already did) without disposing and re-registering every
// contribution a second time mid-paint.
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
  if (result.skipped.length) console.log(`[client] plugins disabled by this node: ${result.skipped.join(', ')}`)
}
