import { paneRegistry } from '@acorn/client-core/registries/panes.ts'
import { prPaneContribution } from '@acorn/plugin-github/client/pullDetail/PrPane.tsx'
import { clientIntegrationProviders, registerIntegrationProvider } from './providerContributions'
import { changesPaneContribution } from '@acorn/plugin-changes/client/paneContribution.ts'
import { notesPaneContribution } from '@acorn/plugin-notes/client/NotesTaskPane.tsx'
import { agentPaneContribution } from '@acorn/plugin-agents/client/paneContribution.ts'
import { contextPaneContribution } from '@acorn/plugin-context/client/paneContribution.ts'
import { editorPaneContribution } from '@acorn/plugin-editor/client/paneContribution.ts'
import { searchPaneContribution } from '@acorn/plugin-editor/client/search/paneContribution.ts'
import { databasePaneContribution } from '@acorn/plugin-database/client/paneContribution.ts'
import { previewPaneContribution } from '@acorn/plugin-preview/client/PreviewTaskPane.tsx'
import { activatePreviewEvents } from '@acorn/plugin-preview/client/PreviewPane.tsx'
import { settingsRegistry } from '@acorn/client-core/registries/settings.ts'
import { settingsPageContributions } from './pageContributions'
import { noticeKindRegistry } from '@acorn/client-core/registries/notices.ts'
import { noticeKindContributions } from '@acorn/client-core/notifications/kindContributions.ts'
import { pollerRegistry } from '@acorn/client-core/registries/pollers.ts'
import { taskStatusPollerContribution } from '@acorn/client-core/tasks/taskStatus.ts'
import { workflowTriggerPollerContribution } from '@acorn/plugin-agents/client/triggerPoller.ts'
import { uiSlotRegistry } from '@acorn/client-core/registries/uiSlots.tsx'
import { shellSlotContributions } from './slotContributions'
import { sourceRegistry } from '@acorn/client-core/registries/sources.ts'
import { dockerSourceContribution } from '@acorn/plugin-docker/client/sourceContribution.tsx'
import { dockerPaneContribution } from '@acorn/plugin-docker/client/paneContribution.ts'
import { dockerTaskPollerContribution } from '@acorn/plugin-docker/client/dockerStore.ts'
import { dockerFooterSlotContribution, dockerRailSlotContribution } from '@acorn/plugin-docker/client/slotContribution.ts'
import { httpSourceContribution } from '@acorn/plugin-http/client/sourceContribution.tsx'
import { httpPaneContribution } from '@acorn/plugin-http/client/paneContribution.ts'
import { purgeStoredHttpDrafts } from '@acorn/plugin-http/client/draft.ts'
import { registerDockerArchiveConcern } from '@acorn/plugin-docker/client/archiveConcern.ts'
import { taskSlotRegistry } from '@acorn/client-core/registries/uiSlots.tsx'
import { persistedStateRegistry } from '@acorn/client-core/persistence/persistedState.ts'
import { persistedSliceContributions } from './persistedSliceContributions'
import { activateScopedStateEviction } from './scopedEviction'
import { agentContextRegistry } from '@acorn/client-core/registries/agentContexts.ts'
import { taskContextAgentContribution } from '@acorn/plugin-context/client/agentContextContribution.ts'
import { terminalAgentContextContribution } from '@acorn/plugin-terminal/client/agentContextContribution.ts'
import { databaseAgentContextContribution } from '@acorn/plugin-database/client/agentContextContribution.ts'
import { dockerAgentContextContribution } from '@acorn/plugin-docker/client/agentContextContribution.ts'
import { httpAgentContextContribution } from '@acorn/plugin-http/client/agentContextContribution.ts'
import { activateManagedAgentReferences } from '@acorn/plugin-agents/client/referenceContribution.ts'
import { agentCenterSourceContribution } from '@acorn/plugin-agents/client/sourceContribution.tsx'
import { agentToolRendererRegistry } from '@acorn/client-core/registries/agentToolRenderers.ts'
import { changesAgentToolRenderer } from '@acorn/plugin-changes/client/agentToolRenderer.tsx'
import { activateManagedAgentNotifications } from '@acorn/plugin-agents/client/managedStore.ts'
import { activateManagedAgentNoticeTargets } from '@acorn/plugin-agents/client/managedSelection.ts'

const panes = [
  prPaneContribution,
  agentPaneContribution,
  changesPaneContribution,
  notesPaneContribution,
  contextPaneContribution,
  editorPaneContribution,
  searchPaneContribution,
  databasePaneContribution,
  previewPaneContribution,
  dockerPaneContribution,
  httpPaneContribution,
]

for (const pane of panes) paneRegistry.register(pane)
for (const contribution of [
  taskContextAgentContribution,
  terminalAgentContextContribution,
  databaseAgentContextContribution,
  dockerAgentContextContribution,
  httpAgentContextContribution,
]) agentContextRegistry.register(contribution)
agentToolRendererRegistry.register(changesAgentToolRenderer)
activateManagedAgentReferences()
activateManagedAgentNotifications()
activateManagedAgentNoticeTargets()
for (const provider of clientIntegrationProviders) registerIntegrationProvider(provider)
// Local sources (no integration row): docker and the API panel are always visible in the rail.
sourceRegistry.register(dockerSourceContribution)
sourceRegistry.register(httpSourceContribution)
sourceRegistry.register(agentCenterSourceContribution)
purgeStoredHttpDrafts()
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
for (const slice of persistedSliceContributions) persistedStateRegistry.register(slice)
activateScopedStateEviction()
// Register this window with the public UI control broker (docs/public-api.md) so
// presentation commands from the automation API can drive it. No-op until a public client connects.
