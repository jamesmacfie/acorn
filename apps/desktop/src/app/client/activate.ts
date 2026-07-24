import { paneRegistry } from '../../core/client/registries/panes'
import { prPaneContribution } from '../../plugins/github/client/pullDetail/PrPane'
import { clientIntegrationProviders, registerIntegrationProvider } from './providerContributions'
import { changesPaneContribution } from '../../plugins/changes/client/paneContribution'
import { notesPaneContribution } from '../../plugins/notes/client/NotesTaskPane'
import { contextPaneContribution } from '../../plugins/context/client/paneContribution'
import { editorPaneContribution } from '../../plugins/editor/client/paneContribution'
import { searchPaneContribution } from '../../plugins/editor/client/search/paneContribution'
import { databasePaneContribution } from '../../plugins/database/client/paneContribution'
import { previewPaneContribution } from '../../plugins/preview/client/PreviewTaskPane'
import { activatePreviewEvents } from '../../plugins/preview/client/PreviewPane'
import { settingsRegistry } from '../../core/client/registries/settings'
import { settingsPageContributions } from './pageContributions'
import { noticeKindRegistry } from '../../core/client/registries/notices'
import { noticeKindContributions } from '../../core/client/notifications/kindContributions'
import { pollerRegistry } from '../../core/client/registries/pollers'
import { taskStatusPollerContribution } from '../../core/client/tasks/taskStatus'
import { workflowTriggerPollerContribution } from '../../plugins/agents/client/triggerPoller'
import { uiSlotRegistry } from '../../core/client/registries/uiSlots'
import { shellSlotContributions } from './slotContributions'
import { sourceRegistry } from '../../core/client/registries/sources'
import { dockerSourceContribution } from '../../plugins/docker/client/sourceContribution'
import { dockerPaneContribution } from '../../plugins/docker/client/paneContribution'
import { dockerTaskPollerContribution } from '../../plugins/docker/client/dockerStore'
import { dockerFooterSlotContribution, dockerRailSlotContribution } from '../../plugins/docker/client/slotContribution'
import { registerDockerArchiveConcern } from '../../plugins/docker/client/archiveConcern'
import { dockerPrefsSlice } from '../../plugins/docker/client/dockerPrefs'
import { taskSlotRegistry } from '../../core/client/registries/uiSlots'
import { persistedStateRegistry } from '../../core/client/persistence/persistedState'
import { persistedFeatureSlices } from '../../core/client/persistence/stateSlices'
import { directPreferenceSlices } from '../../core/client/persistence/preferenceSlices'
import { activateScopedStateEviction } from '../../core/client/persistence/scopedEviction'
import { activateUiControl } from '../../core/client/publicApi/uiControlClient'

const panes = [
  prPaneContribution,
  changesPaneContribution,
  notesPaneContribution,
  contextPaneContribution,
  editorPaneContribution,
  searchPaneContribution,
  databasePaneContribution,
  previewPaneContribution,
  dockerPaneContribution,
]

for (const pane of panes) paneRegistry.register(pane)
for (const provider of clientIntegrationProviders) registerIntegrationProvider(provider)
// Local sources (no integration row): docker is always visible in the rail.
sourceRegistry.register(dockerSourceContribution)
for (const page of settingsPageContributions) settingsRegistry.register(page)
activatePreviewEvents()
for (const kind of noticeKindContributions) noticeKindRegistry.register(kind)
pollerRegistry.register(taskStatusPollerContribution)
pollerRegistry.register(workflowTriggerPollerContribution)
pollerRegistry.register(dockerTaskPollerContribution)
taskSlotRegistry.register(dockerFooterSlotContribution)
taskSlotRegistry.register(dockerRailSlotContribution)
registerDockerArchiveConcern()
for (const contribution of shellSlotContributions) uiSlotRegistry.register(contribution)
for (const slice of [...persistedFeatureSlices, ...directPreferenceSlices]) persistedStateRegistry.register(slice)
persistedStateRegistry.register(dockerPrefsSlice)
activateScopedStateEviction()
// Register this window with the public UI control broker (docs/public-api.md) so
// presentation commands from the automation API can drive it. No-op until a public client connects.
activateUiControl()
