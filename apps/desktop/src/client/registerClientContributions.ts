import { paneRegistry } from './registries/panes'
import { prPaneContribution } from './features/pullDetail/PrPane'
import { clientIntegrationProviders, registerIntegrationProvider } from './features/integrations/providerContributions'
import { changesPaneContribution } from './features/changes/paneContribution'
import { notesPaneContribution } from './features/notes/NotesTaskPane'
import { contextPaneContribution } from './features/context/paneContribution'
import { editorPaneContribution } from './features/editor/paneContribution'
import { searchPaneContribution } from './features/search/paneContribution'
import { databasePaneContribution } from './features/database/paneContribution'
import { previewPaneContribution } from './features/preview/PreviewTaskPane'
import { activatePreviewEvents } from './features/preview/PreviewPane'
import { settingsRegistry } from './registries/settings'
import { settingsPageContributions } from './features/settings/pageContributions'
import { noticeKindRegistry } from './registries/notices'
import { noticeKindContributions } from './features/notifications/kindContributions'
import { pollerRegistry } from './registries/pollers'
import { taskStatusPollerContribution } from './features/tasks/taskStatus'
import { workflowTriggerPollerContribution } from './features/agents/triggerPoller'
import { uiSlotRegistry } from './registries/uiSlots'
import { shellSlotContributions } from './features/shell/slotContributions'
import { persistedStateRegistry } from './persistence/persistedState'
import { persistedFeatureSlices } from './persistence/stateSlices'
import { directPreferenceSlices } from './persistence/preferenceSlices'
import { activateScopedStateEviction } from './persistence/scopedEviction'

const panes = [
  prPaneContribution,
  changesPaneContribution,
  notesPaneContribution,
  contextPaneContribution,
  editorPaneContribution,
  searchPaneContribution,
  databasePaneContribution,
  previewPaneContribution,
]

for (const pane of panes) paneRegistry.register(pane)
for (const provider of clientIntegrationProviders) registerIntegrationProvider(provider)
for (const page of settingsPageContributions) settingsRegistry.register(page)
activatePreviewEvents()
for (const kind of noticeKindContributions) noticeKindRegistry.register(kind)
pollerRegistry.register(taskStatusPollerContribution)
pollerRegistry.register(workflowTriggerPollerContribution)
for (const contribution of shellSlotContributions) uiSlotRegistry.register(contribution)
for (const slice of [...persistedFeatureSlices, ...directPreferenceSlices]) persistedStateRegistry.register(slice)
activateScopedStateEviction()
