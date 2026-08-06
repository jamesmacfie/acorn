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

// `disabled` is deliberately not passed: Settings → Plugins is Phase 4, and neither half of the host has
// a populated list yet (apps/node/src/service/runtime.ts is in the same position). The mechanism is
// where it has to be for that UI to be a list rather than a refactor.
const activated = initClientPlugins(clientPlugins)
if (activated.skipped.length) console.log(`[client:boot] plugins disabled: ${activated.skipped.join(', ')}`)
